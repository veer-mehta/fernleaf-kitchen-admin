import { imageRef } from "./images";

describe("imageRef", () => {
  it.each(["https://example.com/a.jpg", "http://example.com/a.png", "/images/12"])("accepts %s", (value) => {
    expect(imageRef.safeParse(value).success).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:image/png;base64,AAAA", "//evil.example/x.jpg", "/images/abc", "/images/", "/images/1/../2", "/other/1", "ftp://x/y.png"])(
    "rejects %s",
    (value) => {
      expect(imageRef.safeParse(value).success).toBe(false);
    },
  );
});
