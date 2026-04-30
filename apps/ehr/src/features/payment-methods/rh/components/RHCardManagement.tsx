import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import StarOutlineIcon from '@mui/icons-material/StarOutline';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { FC, ReactElement, ReactNode, useState } from 'react';
import { CreditCardBrandIcon } from 'ui-components';
import { RHCreditCardInfo } from 'utils';
import { useDeleteRHPaymentMethod } from '../hooks/useDeleteRHPaymentMethod';
import { RH_PAYMENT_METHODS_QUERY_KEY, useGetRHPaymentMethods } from '../hooks/useGetRHPaymentMethods';
import { useSetDefaultRHPaymentMethod } from '../hooks/useSetDefaultRHPaymentMethod';

export interface RHAddCardFormProps {
  patientId: string;
  onCardAdded: () => void;
  onCancel: () => void;
}

export interface RHCardManagementProps {
  patientId: string | undefined;
  /**
   * Slot for the W2.1 CipherPay-encrypted Add-card form. The component opens
   * a dialog and renders this content; the form is responsible for invoking
   * onCardAdded after successful submission.
   */
  renderAddCardForm?: (props: RHAddCardFormProps) => ReactNode;
  title?: string;
}

const formatCardLabel = (card: RHCreditCardInfo): string => {
  const formattedBrand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  const last = card.last4 ? ' •••• ' + card.last4 : '';
  return formattedBrand + last;
};

export const RHCardManagement: FC<RHCardManagementProps> = ({
  patientId,
  renderAddCardForm,
  title = 'Cards on file',
}) => {
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading, isFetching, refetch } = useGetRHPaymentMethods({ patientId });

  const { mutate: setDefault, isPending: isSettingDefault } = useSetDefaultRHPaymentMethod(patientId);
  const { mutate: deleteCard, isPending: isDeleting } = useDeleteRHPaymentMethod(patientId);

  const cards = data?.cards ?? [];

  const handleSetDefault = (paymentMethodId: string): void => {
    setDefault({
      paymentMethodId,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: [RH_PAYMENT_METHODS_QUERY_KEY, patientId] });
      },
      onError: () => setErrorMessage('Unable to set default card. Please try again.'),
    });
  };

  const handleDelete = (paymentMethodId: string): void => {
    deleteCard({
      paymentMethodId,
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: [RH_PAYMENT_METHODS_QUERY_KEY, patientId] });
      },
      onError: () => setErrorMessage('Unable to remove card. Please try again.'),
    });
  };

  const renderCard = (card: RHCreditCardInfo): ReactElement => (
    <ListItem
      key={card.id}
      secondaryAction={
        <Stack direction="row" spacing={1}>
          {!card.default && (
            <Tooltip title="Set as default">
              <span>
                <IconButton
                  edge="end"
                  aria-label="set default"
                  onClick={() => handleSetDefault(card.id)}
                  disabled={isSettingDefault || isDeleting}
                  size="small"
                >
                  <StarOutlineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          )}
          <Tooltip title="Remove card">
            <span>
              <IconButton
                edge="end"
                aria-label="delete"
                onClick={() => handleDelete(card.id)}
                disabled={isSettingDefault || isDeleting}
                size="small"
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Stack>
      }
    >
      <Box sx={{ mr: 2, display: 'inline-flex', alignItems: 'center' }}>
        <CreditCardBrandIcon brand={card.brand ?? 'generic'} />
      </Box>
      <ListItemText
        primary={
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body1">{formatCardLabel(card)}</Typography>
            {card.default && <Chip label="Default" size="small" color="primary" />}
          </Stack>
        }
      />
    </ListItem>
  );

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="h6">{title}</Typography>
        {renderAddCardForm && (
          <Button variant="outlined" size="small" onClick={() => setAddOpen(true)} disabled={!patientId}>
            Add card
          </Button>
        )}
      </Stack>

      {(isLoading || isFetching) && cards.length === 0 ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
          <CircularProgress size={24} />
        </Box>
      ) : cards.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No cards on file.
        </Typography>
      ) : (
        <List dense disablePadding>
          {cards.map(renderCard)}
        </List>
      )}

      {renderAddCardForm && patientId && (
        <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>Add card</DialogTitle>
          <DialogContent>
            {renderAddCardForm({
              patientId,
              onCardAdded: () => {
                setAddOpen(false);
                void refetch();
              },
              onCancel: () => setAddOpen(false),
            })}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}

      <Snackbar
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        open={errorMessage !== undefined}
        autoHideDuration={5000}
        onClose={() => setErrorMessage(undefined)}
      >
        <Alert onClose={() => setErrorMessage(undefined)} severity="error" variant="filled">
          {errorMessage}
        </Alert>
      </Snackbar>
    </Box>
  );
};
