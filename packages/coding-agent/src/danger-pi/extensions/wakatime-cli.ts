import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { appendWakaTimeLog } from "./wakatime-log";

const GITHUB_DOWNLOAD_URL = "https://github.com/wakatime/wakatime-cli/releases/latest/download";

export class WakaTimeCli {
	#cliLocation?: string;
	#installDir = path.join(os.homedir(), ".wakatime");

	constructor() {
		fs.mkdirSync(this.#installDir, { recursive: true });
	}

	getLocation(): string {
		if (this.#cliLocation) return this.#cliLocation;

		const globalPath = this.#resolveGlobalBinary();
		if (globalPath) {
			this.#cliLocation = globalPath;
			return globalPath;
		}

		const ext = process.platform === "win32" ? ".exe" : "";
		const bundledPath = path.join(this.#installDir, `wakatime-cli${ext}`);
		if (fs.existsSync(bundledPath)) {
			this.#cliLocation = bundledPath;
			return bundledPath;
		}

		return bundledPath;
	}

	async checkAndInstall(): Promise<string> {
		const location = this.getLocation();
		if (fs.existsSync(location)) {
			return location;
		}

		appendWakaTimeLog("cli", "Installing wakatime-cli");
		await this.#install();
		return this.getLocation();
	}

	#resolveGlobalBinary(): string | undefined {
		try {
			const cmd = process.platform === "win32" ? "where" : "which";
			const binary = `wakatime-cli${process.platform === "win32" ? ".exe" : ""}`;
			const resolved = child_process.execSync(`${cmd} ${binary}`, { stdio: ["ignore", "pipe", "ignore"] });
			const globalPath = resolved.toString().split("\n")[0]?.trim();
			if (globalPath && fs.existsSync(globalPath)) return globalPath;
		} catch {
			// Fall through to the managed install path.
		}

		return undefined;
	}

	async #install(): Promise<void> {
		const url = `${GITHUB_DOWNLOAD_URL}/wakatime-cli-${this.#getOsName()}-${this.#getArchitecture()}.zip`;
		const zipPath = path.join(this.#installDir, "wakatime-cli-temp.zip");

		await this.#downloadFile(url, zipPath);
		appendWakaTimeLog("cli", `Extracting wakatime-cli from ${url}`);

		const archive = new Bun.Archive(await Bun.file(zipPath).arrayBuffer());
		const targetPath = path.join(this.#installDir, `wakatime-cli${process.platform === "win32" ? ".exe" : ""}`);
		const binaryName = path.basename(targetPath);
		const files = await archive.files();
		let wroteBinary = false;

		for (const [filePath, file] of files) {
			if (path.basename(filePath) !== binaryName) continue;
			await Bun.write(targetPath, file);
			wroteBinary = true;
			break;
		}

		await fs.promises.rm(zipPath, { force: true });

		if (!wroteBinary) {
			throw new Error(`wakatime-cli archive did not contain ${binaryName}`);
		}

		if (process.platform !== "win32") {
			await fs.promises.chmod(targetPath, 0o755);
		}

		this.#cliLocation = targetPath;
		appendWakaTimeLog("cli", `Installed wakatime-cli to ${targetPath}`);
	}

	async #downloadFile(url: string, destination: string): Promise<void> {
		const response = await fetch(url, { redirect: "follow" });
		if (!response.ok || !response.body) {
			throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
		}

		const output = fs.createWriteStream(destination);
		await finished(Readable.fromWeb(response.body).pipe(output));
	}

	#getOsName(): string {
		if (process.platform === "win32") return "windows";
		return process.platform;
	}

	#getArchitecture(): string {
		const arch = os.arch();
		if (arch.includes("32")) return "386";
		if (arch.includes("x64")) return "amd64";
		return arch;
	}
}
