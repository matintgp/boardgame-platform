export default function Avatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const sizes = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-16 w-16 text-2xl",
  };
  return (
    <span className={`avatar ${sizes[size]}`} aria-hidden="true">
      {initial}
    </span>
  );
}
