// Turning an SVG drawing into a PNG file, so it can be uploaded like any
// other picture. The browser draws the SVG as an image, which runs nothing
// inside it, onto a canvas.

/** The SVG drawn onto a `width` × `height` canvas, as a PNG file named `name`.png. */
export async function svgToPng(svg: string, name: string, width = 1600, height = 900): Promise<File> {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));

  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")?.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Couldn't turn the drawing into a picture");
    return new File([blob], `${name}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** An SVG as an address an <img> can show. */
export function svgAddress(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
