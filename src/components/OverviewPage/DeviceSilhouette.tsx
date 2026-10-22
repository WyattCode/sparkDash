import type { CSSProperties } from 'react';
import type { SparkSnapshot } from '../../api/types';

// Use the whole fleet, independent of table filters. Each live node owns one chassis.
export function DeviceSilhouette({ sparks, className = '' }: { sparks: Pick<SparkSnapshot, 'id' | 'online'>[]; className?: string }) {
  const connected = sparks.filter(spark => spark.online);
  return <div className={`dgx-hero__silhouette ${className}`} aria-hidden="true"
    data-device-count={connected.length}
    style={{ '--device-columns': Math.min(connected.length, 4) } as CSSProperties}>
    {connected.map((spark, index) => <i key={spark.id} data-node-id={spark.id}
      style={{ '--device-column': index % 4, '--device-row': Math.floor(index / 4),
        animationDelay: `${0.16 + index * 0.08}s` } as CSSProperties} />)}
  </div>;
}
