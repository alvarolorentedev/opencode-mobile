import { Content } from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';

// A layout-neutral DOM frame preserves RN flex sizing and animated style arrays.
export function DialogFrame(props: ComponentProps<typeof Content>) {
  return <Content {...props} asChild={false} style={{ display: 'contents', pointerEvents: 'auto' }} />;
}
