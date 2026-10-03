// A plain browser <select> with the app's styling. Simpler and more robust than a custom
// dropdown for the many small pickers in the admin screens.
export function NativeSelect(props: React.ComponentProps<"select">) {
  return (
    <select
      {...props}
      className={`h-9 rounded-md border border-input bg-background px-2 text-sm ${props.className ?? ""}`}
    />
  );
}
