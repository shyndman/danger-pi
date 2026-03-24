/// <reference lib="dom" />

import DOMPurify from "dompurify";
import { marked } from "marked";

type ViewerEvent =
	| { type: "buffer"; buffer: string; revision: number }
	| { type: "status"; busy: boolean }
	| { type: "error"; message: string };

class ViewerClient {
	#container: HTMLElement;
	#summarizeButton: HTMLButtonElement;
	#statusLabel: HTMLElement;
	#socket?: WebSocket;
	#currentBuffer = "";
	#isBusy = false;

	constructor() {
		this.#container = document.getElementById("viewer-content")!;
		this.#summarizeButton = document.getElementById("summarize-btn") as HTMLButtonElement;
		this.#statusLabel = document.getElementById("viewer-status")!;

		this.#summarizeButton.addEventListener("click", () => this.#onSummarizeClick());
		this.#connect();
	}

	#connect() {
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const url = `${protocol}//${window.location.host}/ws`;
		this.#socket = new WebSocket(url);

		this.#socket.onopen = () => {
			this.#statusLabel.textContent = "";
			this.#statusLabel.style.color = "";
		};

		this.#socket.onmessage = event => {
			try {
				const msg = JSON.parse(event.data) as ViewerEvent;
				this.#handleEvent(msg);
			} catch {
				this.#showError("Failed to parse viewer event");
			}
		};

		this.#socket.onclose = () => {
			this.#statusLabel.textContent = "Disconnected. Reconnecting...";
			setTimeout(() => this.#connect(), 1000);
		};

		this.#socket.onerror = () => {
			this.#showError("Viewer connection error");
		};
	}

	#handleEvent(event: ViewerEvent) {
		switch (event.type) {
			case "buffer":
				this.#currentBuffer = event.buffer;
				this.#render();
				break;
			case "status":
				this.#setBusy(event.busy);
				break;
			case "error":
				this.#showError(event.message);
				break;
		}
	}

	#render() {
		const rendered = marked.parse(this.#currentBuffer);
		const sanitized = (DOMPurify as any).sanitize(rendered as string, {
			USE_PROFILES: { html: true },
		});
		this.#container.innerHTML = sanitized;
	}

	#setBusy(busy: boolean) {
		this.#isBusy = busy;
		this.#summarizeButton.disabled = busy;
		this.#statusLabel.textContent = busy ? "Summarizing..." : "";
	}

	#showError(message: string) {
		this.#statusLabel.textContent = `Error: ${message}`;
		this.#statusLabel.style.color = "red";
		setTimeout(() => {
			if (this.#statusLabel.textContent?.startsWith("Error:")) {
				this.#statusLabel.textContent = "";
				this.#statusLabel.style.color = "";
			}
		}, 5000);
	}

	#onSummarizeClick() {
		if (this.#isBusy || !this.#socket || this.#socket.readyState !== WebSocket.OPEN) {
			return;
		}
		this.#socket.send(JSON.stringify({ type: "summarize" }));
	}
}

if (typeof window !== "undefined") {
	document.addEventListener("DOMContentLoaded", () => {
		new ViewerClient();
	});
}
