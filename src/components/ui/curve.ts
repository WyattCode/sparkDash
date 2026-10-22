export interface CurvePoint { x:number;y:number }
export const CURVE_DURATION_MS=560;
export const curveEase=(t:number)=>{const p=Math.max(0,Math.min(1,t));return p*p*(3-2*p);};

/** Monotone cubic interpolation: passes through real samples, never adds peaks. */
export function curveGeometry(input:readonly CurvePoint[]) {
  const points:CurvePoint[]=[];
  for(const p of input){
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))continue;
    if(points.length&&p.x===points.at(-1)!.x)points[points.length-1]=p;
    else if(!points.length||p.x>points.at(-1)!.x)points.push(p);
  }
  const slopes=points.slice(1).map((p,i)=>(p.y-points[i].y)/(p.x-points[i].x));
  const tangents=points.map((_,i)=>i===0?slopes[0]??0:i===points.length-1?slopes[i-1]:slopes[i-1]*slopes[i]<=0?0:2/(1/slopes[i-1]+1/slopes[i]));
  for(let i=0;i<slopes.length;i++){
    const d=slopes[i];if(d===0){tangents[i]=0;tangents[i+1]=0;continue;}
    const a=tangents[i]/d,b=tangents[i+1]/d,length=Math.hypot(a,b);
    if(length>3){const factor=3/length;tangents[i]=factor*a*d;tangents[i+1]=factor*b*d;}
  }
  const segments=points.slice(1).map((to,i)=>{
    const from=points[i],dx=(to.x-from.x)/3;
    return {from,to,c1:{x:from.x+dx,y:from.y+dx*tangents[i]},c2:{x:to.x-dx,y:to.y-dx*tangents[i+1]}};
  });
  return {points,segments};
}
export function curvePath(points:readonly CurvePoint[]) {
  const g=curveGeometry(points);if(!g.points.length)return '';
  const pair=(p:CurvePoint)=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  return `M${pair(g.points[0])}`+g.segments.map(s=>` C${pair(s.c1)} ${pair(s.c2)} ${pair(s.to)}`).join('');
}
export function traceCurve(ctx:CanvasRenderingContext2D,points:readonly CurvePoint[]) {
  const g=curveGeometry(points);if(!g.points.length)return;
  ctx.moveTo(g.points[0].x,g.points[0].y);
  for(const s of g.segments)ctx.bezierCurveTo(s.c1.x,s.c1.y,s.c2.x,s.c2.y,s.to.x,s.to.y);
}
/** Visual geometry only; the readouts and stored metrics stay untouched. */
export function blendCurve(from:readonly CurvePoint[],to:readonly CurvePoint[],p:number):CurvePoint[] {
  if(p>=1||!from.length)return [...to];
  return to.map((point,i)=>{
    const position=to.length<2?from.length-1:i*(from.length-1)/(to.length-1),index=Math.floor(position),fraction=position-index;
    const a=from[index],b=from[Math.min(index+1,from.length-1)];
    const x=a.x+(b.x-a.x)*fraction,y=a.y+(b.y-a.y)*fraction;
    return {x:x+(point.x-x)*p,y:y+(point.y-y)*p};
  });
}
