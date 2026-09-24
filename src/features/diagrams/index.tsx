/**
 * Science diagrams (design bible §3-4): rendered from `science.diagrams` in code. All text
 * is DOM or SVG text — never baked into images.
 *
 *   <Diagram d={diagram} index={i} />      kind: 'levels' | 'ecg' | 'ratio'
 */
import { EcgDiagram } from './EcgDiagram';
import { LevelsDiagram } from './LevelsDiagram';
import type { DiagramData } from './model';
import { RatioDiagram } from './RatioDiagram';
import './diagrams.css';

export type { DiagramData } from './model';
export { TONE_META } from './model';

export function Diagram({ d, index }: { d: DiagramData; index?: number }) {
  switch (d.kind) {
    case 'levels':
      return <LevelsDiagram d={d} index={index} />;
    case 'ecg':
      return <EcgDiagram d={d} index={index} />;
    case 'ratio':
      return <RatioDiagram d={d} index={index} />;
    default:
      return null;
  }
}
