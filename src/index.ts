import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

type Env = { MAGIC_HOUR_API_KEY: string };
type Params =
  | { operation: "create"; media: "image" | "video"; prompt: string }
  | { operation: "recover"; media: "image" | "video"; projectId: string };
type CreatedProject = { id: string; credits_charged: number };
type Project = {
  id: string;
  status: "draft" | "queued" | "rendering" | "complete" | "error" | "canceled";
  credits_charged: number;
  downloads: { url: string; expires_at: string }[];
};

export class MagicHourMedia extends WorkflowEntrypoint<Env, Params> {
  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`https://api.magichour.ai/v1/${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.env.MAGIC_HOUR_API_KEY}`,
        "Content-Type": "application/json",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const message = `Magic Hour returned HTTP ${response.status}.`;
      if (response.status < 500 && response.status !== 429) {
        throw new NonRetryableError(message);
      }
      throw new Error(message);
    }
    return response.json<T>();
  }

  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const params = event.payload;
    if (!params || !["image", "video"].includes(params.media)) {
      throw new NonRetryableError("Choose image or video media.");
    }
    if (!this.env.MAGIC_HOUR_API_KEY) {
      throw new NonRetryableError("Configure the private MAGIC_HOUR_API_KEY secret.");
    }
    let projectId: string;
    if (params.operation === "recover") {
      if (typeof params.projectId !== "string" || !params.projectId.trim()) {
        throw new NonRetryableError("Recovery requires an accepted project ID.");
      }
      projectId = await step.do("accepted-project", async () => params.projectId);
    } else if (params.operation === "create") {
      if (typeof params.prompt !== "string" || !params.prompt.trim()) {
        throw new NonRetryableError("Creation requires a prompt.");
      }
      projectId = await step.do(
        "create-project-no-retries",
        { retries: { limit: 0, delay: "1 second" }, timeout: "40 seconds" },
        async () => {
          const body = params.media === "image"
            ? { image_count: 1, model: "z-image-turbo", resolution: "640px", aspect_ratio: "1:1", style: { prompt: params.prompt } }
            : { end_seconds: 5, model: "ltx-2.5", resolution: "480p", aspect_ratio: "16:9", audio: false, style: { prompt: params.prompt } };
          const created = await this.request<CreatedProject>(
            params.media === "image" ? "ai-image-generator" : "text-to-video",
            { method: "POST", body: JSON.stringify(body) },
          );
          if (typeof created.id !== "string" || !created.id) {
            throw new NonRetryableError("Creation returned no project ID. Reconcile acceptance before submitting again.");
          }
          return created.id;
        },
      );
    } else {
      throw new NonRetryableError("Choose create or recover operation.");
    }

    for (let poll = 0; poll < 120; poll++) {
      const project = await step.do(
        `status-${poll}`,
        { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" }, timeout: "40 seconds" },
        () => this.request<Project>(`${params.media}-projects/${encodeURIComponent(projectId)}`),
      );
      if (project.id !== projectId) {
        throw new NonRetryableError("The status response did not match the accepted project ID.");
      }
      if (project.status === "complete") {
        return { projectId, media: params.media, status: project.status, credits_charged: project.credits_charged, downloads: project.downloads };
      }
      if (project.status === "error" || project.status === "canceled") {
        throw new NonRetryableError(`Magic Hour project ${projectId} ended with ${project.status}.`);
      }
      if (!["draft", "queued", "rendering"].includes(project.status)) {
        throw new NonRetryableError(`Unexpected status for Magic Hour project ${projectId}.`);
      }
      if (poll < 119) await step.sleep(`wait-${poll}`, "15 seconds");
    }
    throw new NonRetryableError(`Polling ended; recover accepted project ${projectId} instead of creating again.`);
  }
}

export default {
  fetch() {
    return new Response("Use authenticated Cloudflare Workflow management or the loopback Local Explorer.", { status: 404 });
  },
};
