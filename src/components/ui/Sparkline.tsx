import {SmoothTrace} from './SmoothTrace';
import {ChartReadout} from './ChartReadout';
import {getMetricHistorySamples} from '../../hooks/metricsStore';
interface SparklineProps {
  source?:{sparkId:string;metric:string};
  label?:string;
  unit?:string;
  timestamps?:readonly number[];
  motionKey?:string;
  data: readonly number[];
  width?: number;
  height?: number;
  color?: string;
  /** When true, render a soft area-fill under the line. */
  area?: boolean;
  /** Compact instrument traces can fit the observed range, not a zero axis. */
  fitRange?: boolean;
}

/**
 * Lightweight inline-SVG sparkline. Optionally renders a translucent area
 * under the polyline so live rates read as a trend rather than a flat line.
 * A faint baseline grid hints at scale without adding chartjunk.
 */
export function Sparkline({
  data,
  width = 84,
  height = 24,
  color = "var(--color-data)",
  area = true,
  fitRange = false,
  motionKey,
  label,
  unit,
  timestamps,
  source,
}: SparklineProps) {
  if (data.length < 2) {
    return (
      <div
        className="sparkline-box inline-block"
        style={{ ["--spark-w" as string]: `${width}px`, ["--spark-h" as string]: `${height}px` }}
      />
    );
  }

  const observedMax = Math.max(...data, ...(fitRange ? [] : [1]));
  const observedMin = Math.min(...data, ...(fitRange ? [] : [0]));
  const cushion = fitRange ? (observedMax - observedMin) * .5 : 0;
  const max = observedMax + cushion;
  const min = observedMin - cushion;
  const span = max - min || 1;
  const pad = 1.5;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = fitRange && max === min ? height / 2 : height - pad - ((v - min) / span) * (height - pad * 2);
    return {x,y};
  });
  const times=timestamps??(source?getMetricHistorySamples(source.sparkId,source.metric).slice(-data.length).map(s=>s.at):undefined);


  return (
    <ChartReadout inline samples={data.map((value,i)=>({value,at:times?.[i]}))} label={label} unit={unit} marker={(index,element)=>{
      const point=points[index],path=element.querySelector<SVGPathElement>('[data-trace-line]');if(!point)return null;
      const svg=element.querySelector('svg'),box=svg?.getBoundingClientRect(),outer=element.getBoundingClientRect();
      const local=(p:{x:number;y:number})=>({x:(box?.left??outer.left)-outer.left+p.x*(box?.width?box.width/width:1),y:(box?.top??outer.top)-outer.top+p.y*(box?.height?box.height/height:1)});
      if(!path||typeof path.getTotalLength!=='function')return local(point);
      // Follow the currently painted path, including its in-flight animation.
      let low=0,high=path.getTotalLength();
      for(let i=0;i<18;i++){const mid=(low+high)/2;if(path.getPointAtLength(mid).x<point.x)low=mid;else high=mid;}
      const current=path.getPointAtLength((low+high)/2);return local(current);
    }}><svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="inline-block align-middle">
      <SmoothTrace points={points} color={color} areaBase={area?height:undefined} fillOpacity={.16} motionKey={motionKey}/>
    </svg></ChartReadout>
  );
}
