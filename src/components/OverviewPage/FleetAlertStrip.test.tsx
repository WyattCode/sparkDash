import { expect, it } from 'vitest';
import { render } from '../../testing/render';
import { makeSpark } from '../../testing/fixtures';
import { FleetAlertStrip } from './FleetAlertStrip';
it('does not report a healthy cluster while GPU telemetry is missing',()=>{
 const s=makeSpark();s.telemetry={updatedAt:{gpu:Date.now()},successful:{gpu:false}};
 const {container}=render(<FleetAlertStrip sparks={[s]}/>);
 expect(container.textContent).toContain('GPU 指标缺失或已过期');expect(container.textContent).not.toContain('当前没有集群异常');
});
it('distinguishes an unobserved model API from proven inference failure',()=>{
 const s=makeSpark();s.role='head';s.workerNode=false;s.llmMonitoring=true;s.metrics.llm=[];
 const {container}=render(<FleetAlertStrip sparks={[s]}/>);
 expect(container.textContent).toContain('模型 API 等待采样');expect(container.textContent).not.toContain('推理失败');
});
