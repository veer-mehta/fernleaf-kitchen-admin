import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface Props extends Omit<React.ComponentProps<typeof Input>, "name"> {
  name: string;
  label: string;
  // The server's `fields` map; the message for this input is looked up by name.
  errors?: Record<string, string>;
}

export function FormField({ name, label, errors, ...inputProps }: Props) {
  const error = errors?.[name];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} aria-invalid={!!error} {...inputProps} />
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
