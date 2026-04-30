import {
  Alert,
  Box,
  Card,
  CircularProgress,
  FormControlLabel,
  Radio,
  RadioGroup,
  Snackbar,
  Typography,
  useTheme,
} from '@mui/material';
import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCardBrandIcon } from 'ui-components';
import { RHCreditCardInfo } from 'utils';
import { BoldPurpleInputLabel } from '../../../components/form';
import { dataTestIds } from '../../../helpers/data-test-ids';
import { otherColors } from '../../../IntakeThemeProvider';
import { useSetDefaultRHPaymentMethod, useSetupRHPaymentMethod } from '../../../telemed/features/paperwork';
import { usePaperworkContext } from '../context';
import { useCreditCardContext } from '../hooks/useCreditCardContext';
import { useCreditCardStore } from '../stores/useCreditCardStore';
import { RHAddCreditCardFormStub } from './RHAddCreditCardFormStub';

interface CreditCardVerificationProps {
  fieldId: string;
  onChange: (event: { target: { value: boolean } }) => void;
  required: boolean;
  value?: boolean;
}

export const CreditCardVerification: FC<CreditCardVerificationProps> = ({ fieldId, onChange, required, value }) => {
  const {
    patient,
    rhPaymentMethods: cards,
    refetchRHPaymentMethods,
    rhCardsAreLoading,
    rhPaymentMethodStateInitializing,
  } = usePaperworkContext();

  useCreditCardContext({ fieldId, onChange, required, value, hasSavedCards: cards.length > 0 });
  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);
  const [pendingSelection, setPendingSelection] = useState<string | undefined>(undefined);
  const defaultCard = useMemo(() => cards.find((card) => card.default), [cards]);
  const [selectedOption, setSelectedOption] = useState<string | undefined>(defaultCard?.id);

  useEffect(() => {
    if (selectedOption !== defaultCard?.id) {
      setSelectedOption(defaultCard?.id);
    }
  }, [cards, defaultCard?.id, selectedOption]);

  const { mutateAsync: setDefaultAsync, isPending: isSetDefaultLoading } = useSetDefaultRHPaymentMethod(patient?.id);
  const { mutateAsync: setupRHCard, isPending: isSetupCardPending } = useSetupRHPaymentMethod(patient?.id);
  const isSavingCard = useCreditCardStore((state) => state.isSavingCard);

  useEffect(() => {
    if (!onChange) return;
    if (selectedOption !== undefined && value !== true) {
      onChange({ target: { value: true } });
    } else if (selectedOption === undefined && value === true) {
      onChange({ target: { value: false } });
    }
  }, [onChange, selectedOption, value]);

  const disabled = rhCardsAreLoading || isSetDefaultLoading || rhPaymentMethodStateInitializing || isSavingCard;

  const onMakePrimary = useCallback(
    async (id: string): Promise<void> => {
      setPendingSelection(id);
      await setDefaultAsync({
        paymentMethodId: id,
        onSuccess: async () => {
          if (value !== true && onChange) {
            onChange({ target: { value: true } });
          }
          await refetchRHPaymentMethods();
          setSelectedOption(id);
          setPendingSelection(undefined);
        },
        onError: (error) => {
          console.error('setDefault error', error);
          setPendingSelection(undefined);
          setErrorMessage('Unable to set default payment method. Please try again later or select a card.');
        },
      });
    },
    [onChange, refetchRHPaymentMethods, setDefaultAsync, value]
  );

  const setupCardCallback = useCallback(
    async (params: { encryptedCardData: string; last4?: string; brand?: string }): Promise<{ paymentMethodId: string }> => {
      const result = await setupRHCard({
        encryptedCardData: params.encryptedCardData,
        makeDefault: cards.length === 0,
      });
      await refetchRHPaymentMethods();
      return { paymentMethodId: result.paymentMethodId };
    },
    [cards.length, refetchRHPaymentMethods, setupRHCard]
  );

  const handleNewPaymentMethod = useCallback(
    async (id: string): Promise<void> => {
      // For the very first card, the setup zambda already marked it default;
      // skip the redundant set-default round-trip and just refresh selection.
      if (cards.length === 0) {
        setSelectedOption(id);
        if (value !== true && onChange) {
          onChange({ target: { value: true } });
        }
        return;
      }
      await onMakePrimary(id);
    },
    [cards.length, onChange, onMakePrimary, value]
  );

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Card sx={{ p: 2, backgroundColor: otherColors.coachingVisit, borderRadius: 2 }} elevation={0}>
        <Typography color="primary.main">
          Please select your preferred payment method for any outstanding balance not covered by your insurance
          provider. If you are self-paying, the selected card will be charged for the total amount due.
        </Typography>
      </Card>
      <CreditCardContent
        pendingSelection={pendingSelection}
        selectedOption={selectedOption}
        cards={cards}
        disabled={disabled}
        isSavingCard={isSavingCard || isSetupCardPending}
        required={required}
        errorMessage={errorMessage}
        setErrorMessage={setErrorMessage}
        onMakePrimary={onMakePrimary}
        handleNewPaymentMethod={handleNewPaymentMethod}
        setupCard={setupCardCallback}
      />
    </Box>
  );
};

interface CreditCardContentProps {
  pendingSelection: string | undefined;
  selectedOption: string | undefined;
  cards: RHCreditCardInfo[];
  disabled: boolean;
  isSavingCard: boolean;
  required: boolean;
  errorMessage: string | undefined;
  setErrorMessage: (message: string | undefined) => void;
  onMakePrimary: (id: string) => Promise<void>;
  handleNewPaymentMethod: (id: string) => Promise<void>;
  setupCard: (params: {
    encryptedCardData: string;
    last4?: string;
    brand?: string;
  }) => Promise<{ paymentMethodId: string }>;
}

const CreditCardContent: FC<CreditCardContentProps> = ({
  pendingSelection,
  cards,
  selectedOption,
  disabled,
  isSavingCard,
  errorMessage,
  required,
  setErrorMessage,
  onMakePrimary,
  handleNewPaymentMethod,
  setupCard,
}) => {
  const theme = useTheme();
  const cardFormRef = useCreditCardStore((state) => state.cardFormRef);
  const handleCardChange = useCreditCardStore((state) => state.handleCardChange);

  return (
    <>
      <Box>
        <BoldPurpleInputLabel
          id="default-card-selection-label"
          htmlFor="default-card-selection-group"
          required={required}
          sx={(theme) => ({
            whiteSpace: 'pre-wrap',
            position: 'unset',
            color: theme.palette.primary.dark,
          })}
        >
          {`${cards.length ? 'Select' : 'Add'} the card you want to pay with`}
        </BoldPurpleInputLabel>
        <RadioGroup
          name="default-card-selection-group"
          aria-label="Default card selection radio group"
          sx={{
            '.MuiFormControlLabel-label': {
              width: '100%',
            },
            gap: 1,
          }}
          value={selectedOption || ''}
          onChange={(e) => void onMakePrimary(e.target.value)}
        >
          {cards.map((item) => {
            const formattedBrand = item.brand ? `${item.brand.charAt(0).toUpperCase()}${item.brand.slice(1)}` : 'Card';
            return (
              <Box key={item.id} sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <FormControlLabel
                  value={item.id}
                  disabled={disabled}
                  control={
                    pendingSelection === item.id ? (
                      <CircularProgress sx={{ maxWidth: '22px', maxHeight: '22px', padding: '9px' }} />
                    ) : (
                      <Radio />
                    )
                  }
                  label={
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        gap: 1,
                      }}
                    >
                      {item.brand && (
                        <Box sx={{ display: 'inline-flex', alignItems: 'center' }}>
                          <CreditCardBrandIcon brand={item.brand} />
                        </Box>
                      )}
                      <Typography
                        data-testid={dataTestIds.cardNumber}
                      >{`${formattedBrand} •••• ${item.last4 ?? '----'}`}</Typography>
                    </Box>
                  }
                  sx={{
                    border: '1px solid',
                    borderRadius: 2,
                    backgroundColor: () => {
                      if (item.id === selectedOption) {
                        return otherColors.lightBlue;
                      } else {
                        return theme.palette.background.paper;
                      }
                    },
                    borderColor: item.id === selectedOption ? 'primary.main' : otherColors.borderGray,
                    paddingTop: 0,
                    paddingBottom: 0,
                    paddingRight: 2,
                    marginX: 0,
                    minHeight: 46,
                  }}
                />
              </Box>
            );
          })}
        </RadioGroup>
      </Box>

      <RHAddCreditCardFormStub
        ref={cardFormRef}
        disabled={disabled}
        isSaving={isSavingCard}
        onCardChange={handleCardChange}
        setupCard={setupCard}
        selectPaymentMethod={handleNewPaymentMethod}
      />
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
    </>
  );
};
