import { useCallback, useState, type ReactElement } from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';

interface Question {
  message: string;
  confirmLabel: string;
  title?: string;
}

interface ConfirmDialogProps extends Question {
  open: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before something is removed, in the app's own words and style; Cancel has the focus. */
export default function ConfirmDialog({ open, title, message, confirmLabel, busy = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      // A dialog opened from a list row is still that row's child to React; a click must not play it.
      onClick={(event) => event.stopPropagation()}
      data-testid="confirm-dialog"
    >
      {title && <DialogTitle>{title}</DialogTitle>}
      <DialogContent sx={title ? undefined : { pt: 3 }}>
        <DialogContentText>{message}</DialogContentText>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy} autoFocus>
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm} disabled={busy} color="error" variant="contained" data-testid="confirm-dialog-confirm">
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

interface AskedQuestion extends Question {
  answer: (confirmed: boolean) => void;
}

/**
 * For handlers that simply need a yes or no before going on:
 * `if (!(await askToConfirm({ message, confirmLabel }))) return;` with `confirmDialog` rendered once.
 */
export function useConfirm(): { askToConfirm: (question: Question) => Promise<boolean>; confirmDialog: ReactElement } {
  const [asked, setAsked] = useState<AskedQuestion | null>(null);

  const askToConfirm = useCallback(
    (question: Question) => new Promise<boolean>((answer) => setAsked({ ...question, answer })),
    [],
  );
  const settle = (confirmed: boolean) => {
    asked?.answer(confirmed);
    setAsked(null);
  };

  const confirmDialog = (
    <ConfirmDialog
      open={asked !== null}
      title={asked?.title}
      message={asked?.message ?? ''}
      confirmLabel={asked?.confirmLabel ?? ''}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
  return { askToConfirm, confirmDialog };
}
