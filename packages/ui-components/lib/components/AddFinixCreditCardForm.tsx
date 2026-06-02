import { LoadingButton } from '@mui/lab';
import { Box, Checkbox, CircularProgress, FormLabel } from '@mui/material';
import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import {
  FinixBinInformation,
  FinixEnvironment,
  FinixFormHandle,
  FinixTokenResponse,
  loadFinixJs,
  normalizeFinixCardBrand,
} from '../utils/finixTokenization';

export interface AddCreditCardFormHandle {
  getCardState: () => { complete: boolean; error?: { message: string } };
  saveCard: () => Promise<{ success: boolean; error?: string }>;
}

// Finix Hosted Fields credit-card form. Renders Finix-hosted iframe inputs
// (card data never touches our code/servers), tokenizes on save, and delegates
// persistence to the consumer-supplied `setupCard` callback (which wraps the
// `finix-payment-methods-setup` zambda). The backend exchanges the token for a
// Payment Instrument and is authoritative for the stored brand/last4.
type FinixCreditCardFormProps = {
  environment: FinixEnvironment;
  applicationId: string;
  disabled: boolean;
  isSaving?: boolean;
  condition?: string;
  setupCard: (params: { token: string; brand?: string }) => Promise<{ paymentMethodId: string }>;
  selectPaymentMethod: (paymentMethodId: string) => void | Promise<void>;
  onCardChange?: () => void;
  showAddButton?: boolean;
};

export const AddFinixCreditCardForm = forwardRef<AddCreditCardFormHandle, FinixCreditCardFormProps>((props, ref) => {
  const {
    environment,
    applicationId,
    disabled,
    isSaving: isSavingProp,
    condition,
    setupCard,
    selectPaymentMethod,
    onCardChange,
    showAddButton = false,
  } = props;

  const reactId = useId();
  const containerId = `finix-form-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const formHandleRef = useRef<FinixFormHandle | undefined>(undefined);
  const brandRef = useRef<string | undefined>(undefined);
  const saveStateRef = useRef<'pending' | 'saving' | 'saved'>('pending');

  const [formReady, setFormReady] = useState(false);
  const [hasErrors, setHasErrors] = useState(true);
  const [internalSaving, setInternalSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [conditionAccepted, setConditionAccepted] = useState(false);

  const isSaving = isSavingProp ?? internalSaving;

  useEffect(() => {
    let cancelled = false;
    if (!applicationId) return;
    loadFinixJs()
      .then((finix) => {
        if (cancelled || !document.getElementById(containerId)) return;
        formHandleRef.current = finix.PaymentForm(containerId, environment, applicationId, {
          showAddress: false,
          requireSecurityCode: true,
          onLoad: () => {
            if (!cancelled) setFormReady(true);
          },
          onUpdate: (_state: unknown, binInformation: FinixBinInformation, formHasErrors: boolean) => {
            if (cancelled) return;
            brandRef.current = normalizeFinixCardBrand(binInformation?.cardBrand);
            setHasErrors(formHasErrors);
            setSaveError(undefined);
            onCardChange?.();
            if (saveStateRef.current === 'saved') saveStateRef.current = 'pending';
          },
        });
      })
      .catch((err) => {
        if (!cancelled) setSaveError(err instanceof Error ? err.message : 'Failed to load payment form');
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId, environment, containerId]);

  const tokenize = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const handle = formHandleRef.current;
      if (!handle) {
        reject(new Error('Payment form is not ready'));
        return;
      }
      handle.submit((error: unknown, response: FinixTokenResponse) => {
        if (error) {
          reject(error instanceof Error ? error : new Error('Failed to tokenize card'));
          return;
        }
        const token = response?.data?.id;
        if (!token) {
          reject(new Error('Finix did not return a token'));
          return;
        }
        resolve(token);
      });
    });

  const saveCard = async (): Promise<{ success: boolean; error?: string }> => {
    if (saveStateRef.current === 'saved') return { success: true };
    if (saveStateRef.current === 'saving') {
      const error = 'Card save already in progress';
      setSaveError(error);
      return { success: false, error };
    }
    if (hasErrors) {
      const error = 'Please complete the card details';
      setSaveError(error);
      return { success: false, error };
    }

    saveStateRef.current = 'saving';
    setInternalSaving(true);
    try {
      const token = await tokenize();
      const { paymentMethodId } = await setupCard({ token, brand: brandRef.current });
      if (!paymentMethodId) {
        throw new Error('Finix did not return a payment method id');
      }
      await selectPaymentMethod(paymentMethodId);
      saveStateRef.current = 'saved';
      setSaveError(undefined);
      return { success: true };
    } catch (err) {
      console.error('[AddFinixCreditCardForm] Failed to save card:', err);
      saveStateRef.current = 'pending';
      const errorMessage = err instanceof Error ? err.message : 'Failed to save card data';
      setSaveError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setInternalSaving(false);
    }
  };

  useImperativeHandle(ref, () => ({
    getCardState: () => ({
      complete: formReady && !hasErrors,
      error: saveError ? { message: saveError } : undefined,
    }),
    saveCard,
  }));

  const cardComplete = formReady && !hasErrors;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        alignItems: 'end',
        backgroundColor: 'rgba(244, 246, 248, 1)',
        borderRadius: 1,
        padding: 2,
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Finix Hosted Fields render into this container */}
      <Box id={containerId} sx={{ width: '100%' }} />
      {!formReady && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, alignSelf: 'start' }}>
          <CircularProgress size={18} />
          <FormLabel>Loading secure card form…</FormLabel>
        </Box>
      )}
      {showAddButton && saveError && (
        <Box sx={{ width: '100%' }}>
          <FormLabel error sx={{ marginLeft: '12px', color: '#d32f2f', fontSize: '0.95rem' }}>
            {saveError}
          </FormLabel>
        </Box>
      )}
      {condition && (
        <Box sx={{ display: 'flex', minWidth: '100%', alignItems: 'center', gap: 1 }}>
          <Checkbox
            id="finix-condition-acceptance"
            checked={conditionAccepted}
            onChange={(e) => setConditionAccepted(e.target.checked)}
            disabled={isSaving}
          />
          <FormLabel htmlFor="finix-condition-acceptance">{condition}</FormLabel>
        </Box>
      )}
      {showAddButton && (
        <LoadingButton
          loading={isSaving}
          disabled={disabled || !cardComplete || Boolean(condition && !conditionAccepted)}
          variant="outlined"
          type="button"
          onClick={() => void saveCard()}
        >
          Add card
        </LoadingButton>
      )}
      {isSaving && !showAddButton && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CircularProgress size={20} />
          <FormLabel>Saving card...</FormLabel>
        </Box>
      )}
    </Box>
  );
});

AddFinixCreditCardForm.displayName = 'AddFinixCreditCardForm';
