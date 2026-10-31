import { createContext, useContext, useEffect, useId, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { Modal, Platform, View, type ModalProps } from 'react-native';
import * as Dialog from '@rn-primitives/dialog';
import { DialogFrame } from './dialog-frame';
import { Portal as PrimitivePortal, PortalHost } from '@rn-primitives/portal';
import { WorkspaceScope, WorkspaceScopeContext } from '@/providers/workspace-context';
import type { WorkspaceTarget } from '@/providers/workspace-types';
import { useDismissOnBack } from '@/hooks/use-dismiss-on-back';

type Host = { name: string; register: (id: string, close: () => void) => () => void };
const HostContext = createContext<Host | undefined>(undefined);

// Radix portals clone their child; keep RN style arrays behind this boundary.
export function PortalScope({ target, children }: PropsWithChildren<{ target?: WorkspaceTarget }>) {
  return target ? <WorkspaceScope target={target}>{children}</WorkspaceScope> : <>{children}</>;
}

export function usePortalHost() { return useContext(HostContext)?.name; }

export function Portal({ children }: { children: ReactNode }) {
  const id = useId();
  const host = useContext(HostContext);
  const workspace = useContext(WorkspaceScopeContext);
  return <PrimitivePortal name={id} hostName={host?.name}>
    <PortalScope target={workspace}>{children}</PortalScope>
  </PrimitivePortal>;
}

export function useOverlayDismiss(visible: boolean, close: () => void) {
  const host = useContext(HostContext);
  const id = useId();
  const callback = useRef(close);
  useEffect(() => { callback.current = close; }, [close]);
  useEffect(() => visible ? host?.register(id, () => callback.current()) : undefined, [host, id, visible]);
  useDismissOnBack(visible && !host && Platform.OS !== 'web', close);
}

// A native Modal is a separate window: nested portals and Back belong to it.
export function ModalSurface({ children, onRequestClose, ...props }: Omit<ModalProps, 'onRequestClose'> & { onRequestClose?: () => void }) {
  const id = useId();
  const dismissals = useRef(new Map<string, () => void>());
  const [host] = useState<Host>(() => ({ name: id, register: (key, close) => {
    dismissals.current.set(key, close);
    return () => { dismissals.current.delete(key); };
  } }));
  function dismiss() {
    const top = [...dismissals.current.values()].at(-1);
    if (top) top(); else onRequestClose?.();
  }
  const content = <HostContext.Provider value={host}>{children}<PortalHost name={id} /></HostContext.Provider>;
  if (Platform.OS === 'web') return <Dialog.Root open={props.visible !== false} onOpenChange={(open) => { if (!open) dismiss(); }}>
    <Dialog.Portal><DialogFrame aria-label={props.accessibilityLabel} aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()}>
      <View className="fixed inset-0 z-50 bg-background">{content}</View>
    </DialogFrame></Dialog.Portal>
  </Dialog.Root>;
  return <Modal {...props} onRequestClose={dismiss}>{content}</Modal>;
}

export { PortalHost };
