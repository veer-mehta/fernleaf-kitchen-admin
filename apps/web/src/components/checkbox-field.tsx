import { Checkbox } from "@/components/ui/checkbox";

interface Props {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  // Visible text; clicking it toggles the box too. Omit it for a bare box (e.g. in a table) and give ariaLabel.
  label?: React.ReactNode;
  ariaLabel?: string;
  indeterminate?: boolean; // "some, not all" (the select-all box in a table header)
  disabled?: boolean;
  className?: string;
}

export function CheckboxField({ checked, onCheckedChange, label, ariaLabel, indeterminate, disabled, className }: Props) {
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${disabled ? "opacity-60" : "cursor-pointer"} ${className ?? ""}`}>
      <Checkbox checked={checked} indeterminate={indeterminate} disabled={disabled} aria-label={ariaLabel} onCheckedChange={(value) => onCheckedChange(value)} />
      {label}
    </label>
  );
}
