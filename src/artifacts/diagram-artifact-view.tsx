import { useEffect, useState } from "react";
import type { DiagramArtifactProps } from "./diagram-artifact";

type Availability = "checking" | "available" | "missing" | "retry";
const messageStyle = { padding: "24px", color: "#475569", fontFamily: "sans-serif" };

function ReadyDiagram({ diagramId, title }: Extract<DiagramArtifactProps, { status: "ready" }>) {
  const [availability, setAvailability] = useState<Availability>("checking");
  const [attempt, setAttempt] = useState(0);
  const url = `/api/artifacts/${encodeURIComponent(diagramId)}`;

  useEffect(() => {
    const controller = new AbortController();
    setAvailability("checking");
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then((response) => {
        if (response.ok) setAvailability("available");
        else if (response.status === 404) setAvailability("missing");
        else setAvailability("retry");
      })
      .catch(() => { if (!controller.signal.aborted) setAvailability("retry"); });
    return () => controller.abort();
  }, [url, attempt]);

  if (availability === "checking") return <div role="status" style={messageStyle}>Checking diagram availability...</div>;
  if (availability === "missing") return <div role="alert" style={messageStyle}>This diagram is no longer available. It may have expired after the server restarted.</div>;
  if (availability === "retry") return <div role="alert" style={messageStyle}>Could not check diagram availability. <button type="button" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>;
  return <iframe src={url} sandbox="allow-scripts allow-downloads" title={title} style={{ width: "100%", height: "100%", border: "none", backgroundColor: "#ffffff" }} />;
}

export function DiagramArtifactView(props: DiagramArtifactProps) {
  if (props.status === "building") return <div role="status" style={messageStyle}>Building diagram...</div>;
  if (props.status === "failed") {
    const details = Array.isArray(props.diagnostics)
      ? props.diagnostics.filter((item): item is { message: string } => item !== null && typeof item === "object" && typeof item.message === "string" && item.message.trim().length > 0)
      : [];
    return <div role="alert" style={messageStyle}>Diagram creation failed: {props.error}{details.length > 0 && <ul>{details.map((item, index) => <li key={index}>{item.message}</li>)}</ul>}</div>;
  }
  return <ReadyDiagram key={props.diagramId} {...props} />;
}
