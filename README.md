# gen_ui_exp — Interactive Generative UI & Diagrams

Phase #1 hello-world self-hosted Generative UI application: **`AgentInterface` + custom diagram components (`Flow`, `Sequence`, `StepExplainer`) + interactive diagram artifacts via vendored `diagramify` runtime + OpenRouter**.

### Public URL
👉 **https://soup-dozens-programmer-republican.trycloudflare.com**

---

### Sample Prompts for Testing

#### 1. Interactive Diagram Artifacts (Stage 2 `create_diagram` tool)
These prompts trigger the model to call `create_diagram`, which generates and delivers an interactive diagram rendered in the sandboxed artifact panel (supports pan/zoom, theme toggling, relationship tracing, and export):

- **Architecture:**
  > "Diagram our deploy pipeline as an interactive architecture map"

- **Sequence / Microservices Handshake:**
  > "Create an interactive sequence diagram showing a checkout request with payment authorization and db commit"

- **Data Pipeline:**
  > "Generate an interactive dataflow diagram for an event ingestion pipeline with Kafka, Flink, and Postgres"

- **Workflow:**
  > "Build an interactive workflow diagram for a customer onboarding and KYC verification process"

*What to expect:* The model streams a preview chip in the chat (`📊 <Title>`). Clicking the chip or **↗ Open** reveals the sandboxed interactive viewer in the right-hand artifact workspace.

---

#### 2. Inline SVG Diagrams (Stage 1 Custom Components)
These prompts test the inline SVG rendering in the chat stream:

- **Flow Diagram:**
  > "Show our CI/CD pipeline as a flow diagram"

- **Sequence Diagram:**
  > "Show the HTTP request lifecycle as an inline sequence diagram"

- **Step Explainer:**
  > "Explain how HTTP caching works step by step"

---

#### 3. Standard Generative UI
- **Dashboard Cards:**
  > "Show a Q4 sales dashboard with revenue metrics and follow-up actions"

---

### Run Locally

```bash
npm install
npm run build
npm run dev
```

For full architecture details, test gates, and troubleshooting, see [RUNBOOK.md](RUNBOOK.md).