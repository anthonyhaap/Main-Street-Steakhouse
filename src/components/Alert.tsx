export function Alert({
  kind = "error",
  children,
}: {
  kind?: "error" | "success" | "info";
  children: React.ReactNode;
}) {
  if (!children) return null;
  const styles = {
    error: "border-red-200 bg-red-50 text-red-700",
    success: "border-turf-100 bg-turf-50 text-turf-700",
    info: "border-blue-200 bg-blue-50 text-blue-700",
  }[kind];
  return (
    <div className={`rounded-lg border px-3 py-2 text-sm ${styles}`} role="alert">
      {children}
    </div>
  );
}
