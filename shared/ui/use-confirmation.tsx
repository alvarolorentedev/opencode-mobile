import { useCallback, useState } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/shared/ui/alert-dialog';
import { Text } from '@/shared/ui/text';
import { useInteractionBlock, type InteractionBlock } from '@/shared/ui/hooks/use-interaction-block';

type Confirmation = { title: string; message: string; action: string; cancel: string; run: () => void };

export function useConfirmation(block?: InteractionBlock) {
  const [pending, setPending] = useState<Confirmation>();
  useInteractionBlock(Boolean(pending), block);
  const confirmAction = useCallback((title: string, message: string, action: string, cancel: string, run: () => void) => {
    setPending({ title, message, action, cancel, run });
  }, []);
  const confirmation = <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) setPending(undefined); }}>
    {pending ? <AlertDialogContent>
      <AlertDialogTitle>{pending.title}</AlertDialogTitle>
      <AlertDialogDescription>{pending.message}</AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel><Text>{pending.cancel}</Text></AlertDialogCancel>
        <AlertDialogAction className="bg-destructive" onPress={() => { const action = pending.run; setPending(undefined); action(); }}><Text className="text-destructive-foreground">{pending.action}</Text></AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent> : null}
  </AlertDialog>;
  return { confirmAction, confirmation };
}
