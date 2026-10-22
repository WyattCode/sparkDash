import {expect,it} from 'vitest';
import {curveGeometry,curvePath,blendCurve} from './curve';
it('passes through real readings without overshooting extrema',()=>{
 const g=curveGeometry([{x:0,y:0},{x:1,y:10},{x:2,y:0},{x:3,y:0}]);
 for(const s of g.segments)for(let t=0;t<=1;t+=.01){const u=1-t,y=u*u*u*s.from.y+3*u*u*t*s.c1.y+3*u*t*t*s.c2.y+t*t*t*s.to.y;expect(y).toBeGreaterThanOrEqual(Math.min(s.from.y,s.to.y)-1e-9);expect(y).toBeLessThanOrEqual(Math.max(s.from.y,s.to.y)+1e-9);}
 expect(curvePath(g.points)).toContain('C');expect(blendCurve([],g.points,1)).toEqual(g.points);
});
