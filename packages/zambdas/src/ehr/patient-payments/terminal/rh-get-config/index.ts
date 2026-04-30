import Oystehr from '@oystehr/sdk';
import { APIGatewayProxyResult } from 'aws-lambda';
import { Location } from 'fhir/r4b';
import {
  getEntityForLocation,
  getRHTerminalSerialFromLocation,
  getSecret,
  INVALID_INPUT_ERROR,
  isValidUUID,
  MISSING_REQUEST_BODY,
  MISSING_REQUIRED_PARAMETERS,
  RH_TERMINAL_DEVICE_FIXTURE_SERIAL,
  RHClinicEntity,
  Secrets,
  SecretsKeys,
} from 'utils';
import { createOystehrClient, getAuth0Token, lambdaResponse, wrapHandler, ZambdaInput } from '../../../../shared';

const ZAMBDA_NAME = 'patient-payments-terminal-rh-get-config';

let oystehrM2MClientToken: string;

export interface RHTerminalGetConfigInput {
  locationId: string;
}

export interface RHTerminalGetConfigResponse {
  terminalID: string;
  entity: RHClinicEntity;
  mode: 'UAT' | 'PROD';
}

export const index = wrapHandler(ZAMBDA_NAME, async (input: ZambdaInput): Promise<APIGatewayProxyResult> => {
  const validatedParameters = validateRequestParameters(input);

  if (!oystehrM2MClientToken) {
    oystehrM2MClientToken = await getAuth0Token(input.secrets);
  }
  const oystehrClient = createOystehrClient(oystehrM2MClientToken, input.secrets);

  const response = await loadRHTerminalConfig(validatedParameters.locationId, input.secrets, oystehrClient);
  return lambdaResponse(200, response);
});

export const loadRHTerminalConfig = async (
  locationId: string,
  secrets: Secrets | null,
  oystehr: Oystehr
): Promise<RHTerminalGetConfigResponse> => {
  const location = await oystehr.fhir.get<Location>({ resourceType: 'Location', id: locationId });
  const entity = await getEntityForLocation(location, oystehr);
  const mode = resolveTerminalMode(secrets);
  const terminalID = getRHTerminalSerialFromLocation(location) ?? terminalFixtureForMode(mode);
  return { terminalID, entity, mode };
};

// Mode is derived from the configured RH services base URL: "*-sandbox*" => UAT,
// otherwise PROD. Keeps mode in lockstep with the keys/credentials in use.
export const resolveTerminalMode = (secrets: Secrets | null): 'UAT' | 'PROD' => {
  const baseUrl = getSecret(SecretsKeys.RH_BASE_URL, secrets);
  return /sandbox/i.test(baseUrl) ? 'UAT' : 'PROD';
};

const terminalFixtureForMode = (mode: 'UAT' | 'PROD'): string => {
  if (mode === 'PROD') {
    throw INVALID_INPUT_ERROR(
      `Location has no Rectangle Health terminal device serial registered (system=https://fhir.oystehr.com/PaymentIdSystem/rectangle-health/terminal-device); refusing to fall back to fixture in PROD mode.`
    );
  }
  return RH_TERMINAL_DEVICE_FIXTURE_SERIAL;
};

export const validateRequestParameters = (input: ZambdaInput): RHTerminalGetConfigInput => {
  if (!input.body) {
    throw MISSING_REQUEST_BODY;
  }
  const { locationId } = JSON.parse(input.body);
  const missing: string[] = [];
  if (!locationId) missing.push('locationId');
  if (missing.length > 0) throw MISSING_REQUIRED_PARAMETERS(missing);
  if (typeof locationId !== 'string' || !isValidUUID(locationId)) {
    throw INVALID_INPUT_ERROR('"locationId" must be a valid UUID.');
  }
  return { locationId };
};
