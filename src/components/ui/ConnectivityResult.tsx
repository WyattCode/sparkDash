import type { SparkTestResponse } from "../../api/types";

export function ConnectivityResult({ result }: { result: SparkTestResponse }) {
  return (
    <div
      className={`mt-3 rounded px-3 py-2 text-xs ${result.ok ? "bg-success/20" : "bg-danger/20"}`}
      role="status"
    >
      <p className={result.ok ? "text-success" : "text-danger"}>
        {result.ok ? "所有必需功能均已通过。" : "一个或多个必需功能检查失败。"}
      </p>
      <ul className="mt-1 space-y-1">
        {result.capabilities.map((capability) => (
          <li key={capability.id} className={capability.status === "fail" ? "text-danger" : "text-muted"}>
            <strong>{capability.label}:</strong>{" "}
            {capability.status === "pass" ? "通过" : capability.status === "fail" ? "失败" : "已跳过"}
            {capability.message ? ` — ${capability.message}` : ""}
            {capability.recovery ? ` ${capability.recovery}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}
