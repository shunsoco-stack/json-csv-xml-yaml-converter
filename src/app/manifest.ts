import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JSON・CSV・XML・YAML変換ツール",
    short_name: "DataShift",
    description: "構造化データを端末内で検証・マッピング・変換",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f5f7",
    theme_color: "#1677ff",
    icons: [
      {
        src: "/icons/data-shift.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
