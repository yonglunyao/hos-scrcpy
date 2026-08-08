export interface UiElement {
  bounds: number[];
  center: { x: number; y: number };
  text?: string;
  originalText?: string;
  hint?: string;
  id?: string;
  key?: string;
  type?: string;
  clickable?: boolean;
  scrollable?: boolean;
  enabled?: boolean;
  checkable?: boolean;
  checked?: boolean;
}
