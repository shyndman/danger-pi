import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { ReadToolGroupComponent } from "@oh-my-pi/pi-coding-agent/modes/components/read-tool-group";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { formatSize } from "@oh-my-pi/pi-coding-agent/tools/truncate";
import { ImageFormat, PhotonImage } from "@oh-my-pi/pi-natives";
import { ImageProtocol, TERMINAL } from "@oh-my-pi/pi-tui/terminal-capabilities";

const BASE64_PIXEL = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/5+hHgAFgwJ/l4cdOAAAAABJRU5ErkJggg==";

describe("ReadToolGroupComponent", () => {
	const originalProtocol = TERMINAL.imageProtocol;
	let base64JpegPixel = "";

	beforeAll(async () => {
		await initTheme("default");
		const pngBytes = new Uint8Array(await Bun.file("packages/ai/test/data/red-circle.png").arrayBuffer());
		const image = await PhotonImage.parse(pngBytes);
		const jpegBuffer = await image.encode(ImageFormat.JPEG, 90);
		base64JpegPixel = Buffer.from(jpegBuffer).toString("base64");
	});

	beforeEach(() => {
		TERMINAL.imageProtocol = null;
	});

	afterEach(() => {
		TERMINAL.imageProtocol = originalProtocol;
	});

	it("renders byte-size indicators and preview fallbacks", () => {
		const component = new ReadToolGroupComponent();
		const byteSize = Buffer.from(BASE64_PIXEL, "base64").byteLength;
		component.updateArgs({ path: "./image.png" }, "call-1");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "Read image" },
					{ type: "image", data: BASE64_PIXEL, mimeType: "image/png" },
				],
				details: { imageByteSize: byteSize },
			},
			false,
			"call-1",
		);

		const rendered = component.render(80).join("\n");
		expect(rendered).toContain(`(${formatSize(byteSize)})`);
		expect(rendered).toContain("[Image: ./image.png [image/png]");
	});

	it("renders previews for multiple entries independently", () => {
		const component = new ReadToolGroupComponent();
		const details = { imageByteSize: Buffer.from(BASE64_PIXEL, "base64").byteLength };
		component.updateArgs({ path: "./one.png" }, "one");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "first" },
					{ type: "image", data: BASE64_PIXEL, mimeType: "image/png" },
				],
				details,
			},
			false,
			"one",
		);
		component.updateArgs({ path: "./two.png" }, "two");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "second" },
					{ type: "image", data: BASE64_PIXEL, mimeType: "image/png" },
				],
				details,
			},
			false,
			"two",
		);

		const lines = component.render(80);
		const previewLines = lines.filter(line => line.includes("[Image: "));
		expect(previewLines).toHaveLength(2);
	});

	it("re-renders previews when expanded state toggles", () => {
		const component = new ReadToolGroupComponent();
		component.updateArgs({ path: "./image.png" }, "toggle");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "image" },
					{ type: "image", data: BASE64_PIXEL, mimeType: "image/png" },
				],
				details: { imageByteSize: Buffer.from(BASE64_PIXEL, "base64").byteLength },
			},
			false,
			"toggle",
		);

		const collapsed = component.render(80).join("\n");
		expect(collapsed).toContain("[Image: ");
		component.setExpanded(true);
		const expanded = component.render(80).join("\n");
		expect(expanded).toContain("[Image: ");
	});

	it("falls back to image sequences when protocol is available", () => {
		TERMINAL.imageProtocol = ImageProtocol.Kitty;
		const component = new ReadToolGroupComponent();
		component.updateArgs({ path: "./kitty.png" }, "kitty");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "kitty" },
					{ type: "image", data: BASE64_PIXEL, mimeType: "image/png" },
				],
				details: { imageByteSize: Buffer.from(BASE64_PIXEL, "base64").byteLength },
			},
			false,
			"kitty",
		);
		const rendered = component.render(80).join("\n");
		expect(rendered).toContain("\x1b_G");
	});

	it("converts non-PNG previews for Kitty protocol", async () => {
		TERMINAL.imageProtocol = ImageProtocol.Kitty;
		let renderRequests = 0;
		const component = new ReadToolGroupComponent({ requestRender: () => renderRequests++ });
		component.updateArgs({ path: "./photo.jpg" }, "jpeg");
		component.updateResult(
			{
				content: [
					{ type: "text", text: "jpeg" },
					{ type: "image", data: base64JpegPixel, mimeType: "image/jpeg" },
				],
				details: { imageByteSize: Buffer.from(base64JpegPixel, "base64").byteLength },
			},
			false,
			"jpeg",
		);

		for (let attempt = 0; attempt < 50; attempt++) {
			const rendered = component.render(80).join("\n");
			if (rendered.includes("\x1b_G")) {
				expect(renderRequests).toBeGreaterThan(0);
				return;
			}
			await Bun.sleep(10);
		}

		const rendered = component.render(80).join("\n");
		expect(rendered).toContain("\x1b_G");
	});
});
