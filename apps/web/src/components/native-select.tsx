"use client";

import { Children, Fragment, isValidElement } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  value?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
  children?: React.ReactNode; // <option value="...">Label</option> elements, as with a browser <select>
  className?: string;
  disabled?: boolean;
  id?: string;
  "aria-label"?: string;
}

interface Choice { value: string; label: React.ReactNode; disabled?: boolean }

// Reads <option> children (also inside fragments or mapped arrays) into a plain list.
function readOptions(children: React.ReactNode): Choice[] {
  const out: Choice[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string | number; children?: React.ReactNode; disabled?: boolean }>(child)) return;
    if (child.type === Fragment) out.push(...readOptions(child.props.children));
    else out.push({ value: String(child.props.value ?? ""), label: child.props.children, disabled: child.props.disabled });
  });
  return out;
}

// A dropdown that keeps the browser <select> API the screens were written against (<option> children,
// `value`, and `onChange` reading `e.target.value`) but draws the list in the app's own theme.
// A real browser <select> list is drawn by the operating system and cannot be styled.
export function NativeSelect({ value, onChange, children, className, disabled, id, "aria-label": ariaLabel }: Props) {
  const choices = readOptions(children);
  return (
    // The wrapper keeps the Select's hidden form input inside this one box. Left loose, it becomes a
    // sibling of the trigger, and the surrounding form's spacing then pushes the dropdown out of line.
    <span className={`relative inline-flex align-top ${className ?? ""}`}>
    <Select
      value={String(value ?? "")}
      onValueChange={(next) => onChange?.({ target: { value: next ?? "" } })}
      items={choices.map((c) => ({ value: c.value, label: c.label }))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-label={ariaLabel} className="min-w-36 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        {choices.map((c) => (
          <SelectItem key={c.value} value={c.value} disabled={c.disabled}>
            {c.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
    </span>
  );
}
