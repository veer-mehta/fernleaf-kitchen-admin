"use client";

import { useState } from "react";
import { formatScaled, parseDecimalToInt } from "@fernleaf/shared";
import { Input } from "@/components/ui/input";

// A money input. The person types rupees ("12.50"); the screen only ever stores whole cents.
// onCommit fires when they leave the field with a valid value (or null when emptied).
export function CentsInput({
  cents,
  onCommit,
  allowEmpty = false,
  ...rest
}: {
  cents: number | null;
  onCommit: (cents: number | null) => void;
  allowEmpty?: boolean;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "onBlur">) {
  const shown = cents === null ? "" : formatScaled(cents, 2, true);
  const [text, setText] = useState<string | null>(null); // null = show the stored value
  const [invalid, setInvalid] = useState(false);

  function commit() {
    if (text === null) return; // nothing typed
    const trimmed = text.trim();
    if (trimmed === "") {
      if (!allowEmpty) return setInvalid(true);
      setInvalid(false);
      setText(null);
      return onCommit(null);
    }
    const parsed = parseDecimalToInt(trimmed, 2);
    if (parsed === null || parsed < 0) return setInvalid(true);
    setInvalid(false);
    setText(null);
    onCommit(parsed);
  }

  return (
    <Input
      {...rest}
      inputMode="decimal"
      aria-invalid={invalid}
      value={text ?? shown}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
