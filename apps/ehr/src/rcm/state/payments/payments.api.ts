import Oystehr from '@oystehr/sdk';
import { Location } from 'fhir/r4b';
import { chooseJson } from 'utils';

const GET_PAYMENT_LOCATIONS_ZAMBDA_ID = 'get-payment-locations';

export interface PaymentLocation {
  location: Location;
  supportsVirtualVisits: boolean;
}

export interface GetPaymentLocationsResponse {
  locations: PaymentLocation[];
}

export const getPaymentLocations = async (oystehr: Oystehr): Promise<GetPaymentLocationsResponse> => {
  try {
    if (GET_PAYMENT_LOCATIONS_ZAMBDA_ID == null) {
      throw new Error('get-payment-locations zambda ID could not be loaded');
    }

    const response = await oystehr.zambda.execute({
      id: GET_PAYMENT_LOCATIONS_ZAMBDA_ID,
    });
    return chooseJson(response);
  } catch (error: unknown) {
    console.log(error);
    throw error;
  }
};
