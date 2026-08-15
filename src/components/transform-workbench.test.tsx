import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TransformWorkbench } from "./transform-workbench";

describe("TransformWorkbench", () => {
  it("runs the built-in EC mapping pipeline and exposes the structured views", () => {
    render(<TransformWorkbench />);

    expect(screen.getByText("JSON・CSV・XML・YAML変換ツール")).toBeInTheDocument();
    const output = screen.getByLabelText("OUTPUT CSV editor") as HTMLTextAreaElement;
    expect(output.value).toContain("orderId");
    expect(output.value).toContain("EC-2026-0813-001");
    expect(output.value).not.toContain("EC-2026-0813-002");

    fireEvent.click(screen.getByRole("tab", { name: /Table/ }));
    expect(screen.getByRole("columnheader", { name: "orderId" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Validation/ }));
    expect(screen.getByText("構文と変換ルールを通過しました")).toBeInTheDocument();
  });
});
