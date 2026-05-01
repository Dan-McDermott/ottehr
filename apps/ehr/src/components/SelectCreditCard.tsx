import {
  Alert,
  Autocomplete,
  AutocompleteRenderInputParams,
  CircularProgress,
  FormHelperText,
  Snackbar,
  TextField,
} from '@mui/material';
import { Box } from '@mui/system';
import { Patient } from 'fhir/r4b';
import { FC, useState } from 'react';
import { useGetRHPaymentMethods } from 'src/features/payment-methods/rh/hooks/useGetRHPaymentMethods';
import { useSetDefaultRHPaymentMethod } from 'src/features/payment-methods/rh/hooks/useSetDefaultRHPaymentMethod';
import { useSetupRHPaymentMethod } from 'src/features/payment-methods/rh/hooks/useSetupRHPaymentMethod';
import { AddRHCreditCardForm, CreditCardBrandIcon } from 'ui-components';
import { RHCreditCardInfo } from 'utils';

interface CardOption {
  id: string;
  label: string;
  brand?: RHCreditCardInfo['brand'];
  isNew?: boolean;
}

interface CreditCardContentProps {
  patient: Patient;
  appointmentId: string | undefined;
  selectedCardId: string;
  handleCardSelected: (newVal: string | undefined) => void;
  error?: string;
}

const labelForCard = (card: RHCreditCardInfo): string => {
  const formattedBrand = card.brand ? card.brand.charAt(0).toUpperCase() + card.brand.slice(1) : 'Card';
  return `${formattedBrand} •••• ${card.last4 ?? '----'}${card.default ? ' (Primary)' : ''}`;
};

const NEW_CARD = { id: 'new', label: 'Add new card' };

const CreditCardContent: FC<CreditCardContentProps> = (props) => {
  const { patient, selectedCardId, handleCardSelected, error } = props;
  const [cards, setCards] = useState<RHCreditCardInfo[]>([]);

  const [errorMessage, setErrorMessage] = useState<string | undefined>(undefined);

  const { mutate: setDefault } = useSetDefaultRHPaymentMethod(patient?.id);
  const { mutateAsync: setupRHCard } = useSetupRHPaymentMethod(patient?.id);

  const {
    isFetching: cardsAreLoading,
    isFetched: cardsFetched,
    refetch: refetchPaymentMethods,
  } = useGetRHPaymentMethods({
    patientId: patient?.id,
    onSuccess: (data) => {
      if (!data) return;
      setCards(data.cards ?? []);
      const defaultCard = data.cards.find((card) => card.default);
      if (defaultCard && !selectedCardId) {
        handleCardSelected(defaultCard.id);
      }
    },
  });

  const showNewCard = (() => {
    const hasNone = cardsFetched && !cardsAreLoading && cards.length === 0;
    const addingOne = selectedCardId === NEW_CARD.id;
    return hasNone || addingOne;
  })();

  const initializing = !cardsFetched && cardsAreLoading;

  const cardOptions: CardOption[] = [
    ...cards.map((card) => ({ id: card.id, label: labelForCard(card), brand: card.brand })),
    { id: NEW_CARD.id, label: NEW_CARD.label, isNew: true },
  ];

  const selectedCard = cardOptions.find((card) => card.id === selectedCardId);
  const someDefault = cards.some((card) => card.default);

  const setupCard = async (params: {
    encryptedCardData: string;
    last4?: string;
    brand?: string;
  }): Promise<{ paymentMethodId: string }> => {
    const result = await setupRHCard({
      encryptedCardData: params.encryptedCardData,
      makeDefault: !someDefault,
    });
    await refetchPaymentMethods();
    return { paymentMethodId: result.paymentMethodId };
  };

  const handleNewPaymentMethod = async (id: string, makeDefault: boolean): Promise<void> => {
    if (makeDefault) {
      setDefault({
        paymentMethodId: id,
        onSuccess: async () => {
          await refetchPaymentMethods();
        },
        onError: (error) => {
          console.error('setDefault error', error);
          setErrorMessage('Unable to set default payment method. Please try again later or select a card.');
        },
      });
    } else {
      await refetchPaymentMethods();
    }
    handleCardSelected(id);
  };

  if (initializing) {
    return (
      <Box
        sx={{
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }
  const currentValue = selectedCard;
  const showCardList = cards.length > 0;
  return (
    <>
      <Autocomplete
        size="small"
        aria-label="Default card selection radio group"
        fullWidth
        sx={{
          '.MuiFormControlLabel-label': {
            width: '100%',
          },
          gap: 1,
          display: showCardList ? 'initial' : 'none',
          marginBottom: 2,
        }}
        options={cardOptions}
        renderOption={(props, option) => (
          <li {...props} key={option.id}>
            {option.brand && (
              <Box sx={{ mr: 1, display: 'inline-flex', alignItems: 'center' }}>
                <CreditCardBrandIcon brand={option.brand} />
              </Box>
            )}
            {option.label}
          </li>
        )}
        value={currentValue ?? null}
        renderInput={(params: AutocompleteRenderInputParams) => {
          return (
            <Box>
              <TextField
                {...params}
                fullWidth
                required
                label="Credit card"
                variant="outlined"
                error={Boolean(error)}
                InputLabelProps={{ shrink: true }}
                InputProps={{
                  ...params.InputProps,
                  startAdornment: currentValue?.brand ? (
                    <>
                      <Box sx={{ mr: 1, display: 'inline-flex', alignItems: 'center' }}>
                        <CreditCardBrandIcon brand={currentValue.brand} />
                      </Box>
                      {params.InputProps.startAdornment}
                    </>
                  ) : (
                    params.InputProps.startAdornment
                  ),
                }}
                inputProps={{
                  ...params.inputProps,
                  autoComplete: 'off',
                }}
              />
              {error && <FormHelperText error={Boolean(error)}>{error}</FormHelperText>}
            </Box>
          );
        }}
        onChange={(_event, value) => {
          handleCardSelected(value?.id);
        }}
      />

      <Box
        sx={{
          width: '100%',
          display: showNewCard ? 'flex' : 'none',
          justifyContent: 'center',
          alignItems: 'flex-start',
          flexDirection: 'column',
          marginTop: 2,
        }}
      >
        <AddRHCreditCardForm
          disabled={false}
          setupCard={setupCard}
          selectPaymentMethod={(id) => {
            void handleNewPaymentMethod(id, !someDefault);
          }}
          condition="I have obtained the consent to add a card on file from the patient"
          showAddButton={true}
        />
        {error && !showCardList && <FormHelperText error={Boolean(error)}>{error}</FormHelperText>}
      </Box>

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

export default CreditCardContent;
