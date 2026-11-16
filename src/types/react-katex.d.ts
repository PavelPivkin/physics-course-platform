declare module "react-katex" {
  import type { ComponentType, ReactNode } from "react";

  export interface MathComponentProps {
    math?: string;
    children?: ReactNode;
    errorColor?: string;
    renderError?: (error: Error) => ReactNode;
  }

  export const BlockMath: ComponentType<MathComponentProps>;
  export const InlineMath: ComponentType<MathComponentProps>;

  const ReactKatex: {
    BlockMath: ComponentType<MathComponentProps>;
    InlineMath: ComponentType<MathComponentProps>;
  };

  export default ReactKatex;
}
