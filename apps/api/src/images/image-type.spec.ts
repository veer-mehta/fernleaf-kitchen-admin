import { detectImageType } from "./image-type";

const bytes = (...values: number[]) => Buffer.from(values);

describe("detectImageType", () => {
  it("recognises JPEG, PNG and WebP by their first bytes", () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toBe("image/jpeg");
    expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe("image/png");
    expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), bytes(1, 2, 3, 4), Buffer.from("WEBP")]))).toBe("image/webp");
  });

  it("refuses anything else, whatever the client claimed", () => {
    expect(detectImageType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(detectImageType(Buffer.from("GIF89a"))).toBeNull();
    expect(detectImageType(Buffer.from("RIFF1234WAVE"))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});
