/** Translate known application errors only; never transform model output or identifiers. */
const errors: Record<string, string> = {
  'Heartbeat timeout': '页面连接中断，演示已因心跳超时停止。',
  'Cancelled by user': '用户已停止演示。',
  'Cancelled': '已取消。',
  'Too many benchmark requests; try again shortly': '基准测试请求过于频繁，请稍后重试。',
  'Benchmark cooldown is active; wait before starting another job': '基准测试仍在冷却期，请稍后再启动。',
  'Authentication required': '需要有效的访问令牌',
  'Remote access requires SPARKDASH_TOKEN': '远程访问需要配置 SPARKDASH_TOKEN',
  'Spark not found': '找不到节点',
  'A decode benchmark is already running for this Spark': '该节点正在进行解码基准测试，请等待完成，或到节点详情中手动停止测试后再运行演示。',
  'A benchmark is already running for this Spark': '该节点已有基准测试正在运行，请等待完成后重试。',
  'A prefill benchmark is already running for this Spark': '该节点正在进行预填充基准测试，请等待完成，或到节点详情中手动停止测试。',
  'A prompt showcase is already running for this Spark': '该节点已有提示词演示正在运行，请等待完成或查看当前演示。',
  'A showcase is already running for this Spark': '该节点已有提示词演示正在运行，请等待完成或查看当前演示。',
  'Global active benchmark cap reached; wait for a job to finish': '同时运行的基准测试已达上限，请等待已有任务完成。',
  'Cannot clear history while a benchmark is running': '基准测试运行中，暂不能清空历史记录。',
  'Cannot clear history while a showcase is running': '演示运行中，暂不能清空历史记录。',
  'Benchmark not found': '找不到基准测试记录',
  'Showcase session not found': '找不到演示会话',
  'Worker nodes do not expose a local LLM API': '工作节点不提供独立模型 API，请在主节点操作。',
  'LLM monitoring is disabled for this Spark': '该节点未开启模型监控。',
  'ComfyUI monitoring is disabled for this Spark': '该节点未开启 ComfyUI 监控。',
  'Hermes Agent monitoring is disabled for this Spark (enable it in Edit Spark)': '该节点未开启 Hermes 监控，请在编辑节点中开启。',
  'Invalid port': '端口无效，请输入 1–65535 之间的整数。',
  'Invalid LLM port': '模型端口无效，请输入 1–65535 之间的整数。',
  'port is required': '请填写端口。',
  'port is not configured for this Spark': '该节点尚未配置此端口。',
  'port must be an integer 1–65535': '端口必须是 1–65535 之间的整数。',
  'llmPort must be an integer 1–65535': '模型端口必须是 1–65535 之间的整数。',
  'llmPorts must contain at least one valid port 1–65535': '至少保留一个有效模型端口（1–65535）。',
  'Cannot remove the primary LLM port': '不能移除主模型端口。',
  'Cannot remove the last LLM port': '不能移除最后一个模型端口。',
  'password is required': '请填写密码。',
  'lanIp or ssh.host required': '请填写局域网地址或 SSH 主机地址。',
  'promptId is required': '缺少任务 ID。',
};

export function translateApiError(message: string): string {
  if (errors[message]) return errors[message];
  const tokens = /^maxTokens must be between (\d+) and (\d+)$/.exec(message);
  if (tokens) return `最大 Token 数必须在 ${tokens[1]} 到 ${tokens[2]} 之间。`;
  const temperature = /^temperature must be between ([\d.]+) and ([\d.]+)$/.exec(message);
  if (temperature) return `采样温度必须在 ${temperature[1]} 到 ${temperature[2]} 之间。`;
  return message;
}
