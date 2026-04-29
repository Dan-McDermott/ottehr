import { TabContext, TabList, TabPanel } from '@mui/lab';
import { Autocomplete, Box, debounce, Tab, TextField } from '@mui/material';
import { ErxSearchAllergensResponse, ErxSearchMedicationsResponse } from '@oystehr/sdk';
import { useQuery } from '@tanstack/react-query';
import { QuestionnaireItemAnswerOption, Reference } from 'fhir/r4b';
import React, { ReactElement, useCallback, useMemo, useState } from 'react';
import {
  createAllergyQuickPick,
  createInsuranceQuickPick,
  createMedicalConditionQuickPick,
  createMedicationHistoryQuickPick,
  getAllergyQuickPicks,
  getInsuranceQuickPicks,
  getMedicalConditionQuickPicks,
  getMedicationHistoryQuickPicks,
  removeAllergyQuickPick,
  removeInsuranceQuickPick,
  removeMedicalConditionQuickPick,
  removeMedicationHistoryQuickPick,
} from 'src/api/api';
import {
  ExtractObjectType,
  useGetAllergiesSearch,
  useGetMedicationsSearch,
  useICD10SearchNew,
} from 'src/features/visits/shared/stores/appointment/appointment.queries';
import { useApiClients } from 'src/hooks/useAppClients';
import {
  AllergyQuickPickData,
  dedupeObjectsByKey,
  InsuranceQuickPickData,
  MedicalConditionQuickPickData,
  MedicationHistoryQuickPickData,
} from 'utils';
import ImmunizationQuickPicksPage from './ImmunizationQuickPicksPage';
import InHouseMedicationQuickPicksPage from './InHouseMedicationQuickPicksPage';
import ProcedureQuickPicksPage from './ProcedureQuickPicksPage';
import QuickPickEditor from './QuickPickEditor';
import RadiologyQuickPicksPage from './RadiologyQuickPicksPage';

type SubTab =
  | 'procedures'
  | 'allergies'
  | 'insurance'
  | 'medical-conditions'
  | 'medications'
  | 'radiology'
  | 'immunizations'
  | 'in-house-medications';

const AllergenSearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onExtraData?: (data: Record<string, string>) => void;
}> = ({ value, onChange, onExtraData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const { isFetching: isSearching, data } = useGetAllergiesSearch(debouncedSearchTerm);

  const options = useMemo(() => {
    if (!data || isSearching) return [];
    return data.map((allergy) => {
      const brandName = allergy.brandName;
      if (brandName && brandName !== allergy.name) {
        return { ...allergy, name: `${allergy.name} (${brandName})` };
      }
      return allergy;
    });
  }, [data, isSearching]);

  const debouncedSetSearch = useMemo(
    () =>
      debounce((term: string) => {
        if (term.length > 2) {
          setDebouncedSearchTerm(term);
        }
      }, 800),
    []
  );

  const selectedOption = value ? ({ name: value } as ExtractObjectType<ErxSearchAllergensResponse>) : null;

  return (
    <Autocomplete
      value={selectedOption}
      inputValue={searchTerm || value}
      onInputChange={(_e, newInputValue, reason) => {
        if (reason === 'input') {
          setSearchTerm(newInputValue);
          debouncedSetSearch(newInputValue);
        }
      }}
      onChange={(_e, selected) => {
        if (selected) {
          onChange(selected.name);
          onExtraData?.({ allergyId: selected.id?.toString() ?? '' });
          setSearchTerm('');
        } else {
          onChange('');
          onExtraData?.({ allergyId: '' });
        }
      }}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.name || '')}
      isOptionEqualToValue={(option, val) => option.name === val.name}
      options={options}
      loading={isSearching}
      filterOptions={(x) => x}
      fullWidth
      noOptionsText={
        debouncedSearchTerm && debouncedSearchTerm.length > 2 && options.length === 0
          ? 'Nothing found for this search criteria'
          : 'Start typing to load results'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Agent/Substance"
          placeholder="Search allergens..."
          required
          InputLabelProps={{ shrink: true }}
        />
      )}
    />
  );
};

const MedicationSearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onExtraData?: (data: Record<string, string>) => void;
}> = ({ value, onChange, onExtraData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const { isFetching: isSearching, data } = useGetMedicationsSearch(debouncedSearchTerm);
  const options = data || [];

  const debouncedSetSearch = useMemo(
    () =>
      debounce((term: string) => {
        if (term.length > 2) {
          setDebouncedSearchTerm(term);
        }
      }, 800),
    []
  );

  const selectedOption = value ? ({ name: value } as ExtractObjectType<ErxSearchMedicationsResponse>) : null;

  return (
    <Autocomplete
      value={selectedOption}
      inputValue={searchTerm || value}
      onInputChange={(_e, newInputValue, reason) => {
        if (reason === 'input') {
          setSearchTerm(newInputValue);
          debouncedSetSearch(newInputValue);
        }
      }}
      onChange={(_e, selected) => {
        if (selected) {
          onChange(selected.name);
          onExtraData?.({
            strength: selected.strength ?? '',
            medicationId: selected.id?.toString() ?? '',
          });
          setSearchTerm('');
        } else {
          onChange('');
          onExtraData?.({ strength: '', medicationId: '' });
        }
      }}
      getOptionLabel={(option) =>
        typeof option === 'string' ? option : `${option.name}${option.strength ? ` (${option.strength})` : ''}`
      }
      isOptionEqualToValue={(option, val) => option.name === val.name}
      options={options}
      loading={isSearching}
      filterOptions={(x) => x}
      fullWidth
      noOptionsText={
        debouncedSearchTerm && debouncedSearchTerm.length > 2 && options.length === 0
          ? 'Nothing found for this search criteria'
          : 'Start typing to load results'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Medication"
          placeholder="Search medications..."
          required
          InputLabelProps={{ shrink: true }}
        />
      )}
    />
  );
};

const MedicalConditionSearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onExtraData?: (data: Record<string, string>) => void;
}> = ({ value, onChange, onExtraData }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const { isFetching: isSearching, data } = useICD10SearchNew({ search: debouncedSearchTerm });
  const options = data?.codes || [];

  const debouncedSetSearch = useMemo(
    () =>
      debounce((term: string) => {
        setDebouncedSearchTerm(term);
      }, 800),
    []
  );

  const selectedOption = value ? { display: value, code: '' } : null;

  return (
    <Autocomplete
      value={selectedOption}
      inputValue={searchTerm || value}
      onInputChange={(_e, newInputValue, reason) => {
        if (reason === 'input') {
          setSearchTerm(newInputValue);
          debouncedSetSearch(newInputValue);
        }
      }}
      onChange={(_e, selected) => {
        if (selected) {
          onChange(selected.display);
          onExtraData?.({ code: selected.code });
          setSearchTerm('');
        } else {
          onChange('');
          onExtraData?.({ code: '' });
        }
      }}
      getOptionLabel={(option) => (typeof option === 'string' ? option : `${option.code} ${option.display}`)}
      isOptionEqualToValue={(option, val) => option.display === val.display}
      options={options}
      loading={isSearching}
      filterOptions={(x) => x}
      fullWidth
      noOptionsText={
        debouncedSearchTerm && options.length === 0
          ? 'Nothing found for this search criteria'
          : 'Start typing to load results'
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label="Medical Condition"
          placeholder="Search ICD-10 codes..."
          required
          InputLabelProps={{ shrink: true }}
        />
      )}
    />
  );
};

const InsuranceCarrierSearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  onExtraData?: (data: Record<string, string>) => void;
}> = ({ value, onChange, onExtraData }) => {
  const { oystehrZambda } = useApiClients();
  const [searchTerm, setSearchTerm] = useState('');

  const { isFetching, data } = useQuery({
    queryKey: ['insurance-carrier-options'],
    queryFn: async () => {
      if (!oystehrZambda) throw new Error('API client not available');
      const res = await oystehrZambda.zambda.execute({
        id: 'get-answer-options',
        answerSource: {
          resourceType: 'Organization',
          query: 'type=http://terminology.hl7.org/CodeSystem/organization-type|pay',
          prependedIdentifier: 'http://terminology.hl7.org/CodeSystem/v2-0203',
        },
      });
      const output = (res.output as Partial<QuestionnaireItemAnswerOption>[]).map(
        (option) => ({ ...option.valueReference }) as Reference
      );
      return dedupeObjectsByKey(output, 'display');
    },
    enabled: !!oystehrZambda,
  });

  const options = data ?? [];
  const selectedOption = value ? options.find((o) => o.display === value) ?? ({ display: value } as Reference) : null;

  return (
    <Autocomplete
      value={selectedOption}
      inputValue={searchTerm || value}
      onInputChange={(_e, newInputValue, reason) => {
        if (reason === 'input') setSearchTerm(newInputValue);
      }}
      onChange={(_e, selected) => {
        if (selected && selected.reference) {
          onChange(selected.display ?? '');
          const orgId = selected.reference.startsWith('Organization/')
            ? selected.reference.slice('Organization/'.length)
            : selected.reference;
          onExtraData?.({ organizationId: orgId });
          setSearchTerm('');
        } else {
          onChange('');
          onExtraData?.({ organizationId: '' });
        }
      }}
      getOptionLabel={(option) => option?.display ?? ''}
      isOptionEqualToValue={(option, val) => option.reference === val.reference}
      options={options}
      loading={isFetching}
      fullWidth
      noOptionsText={isFetching ? 'Loading...' : 'No insurance carriers found'}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Insurance"
          placeholder="Search insurance carriers..."
          required
          InputLabelProps={{ shrink: true }}
        />
      )}
    />
  );
};

export default function QuickPicksAdminPage(): ReactElement {
  const [subTab, setSubTab] = useState<SubTab>('procedures');
  const { oystehrZambda } = useApiClients();

  // ── Allergy callbacks ──
  const fetchAllergies = useCallback(async () => {
    if (!oystehrZambda) return [];
    const response = await getAllergyQuickPicks(oystehrZambda);
    return response.quickPicks;
  }, [oystehrZambda]);

  const createAllergy = useCallback(
    async (data: Omit<AllergyQuickPickData, 'id'>) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      const response = await createAllergyQuickPick(oystehrZambda, { quickPick: data });
      return response.quickPick;
    },
    [oystehrZambda]
  );

  const removeAllergy = useCallback(
    async (id: string) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      await removeAllergyQuickPick(oystehrZambda, id);
    },
    [oystehrZambda]
  );

  // ── Insurance callbacks ──
  const fetchInsurance = useCallback(async () => {
    if (!oystehrZambda) return [];
    const response = await getInsuranceQuickPicks(oystehrZambda);
    return response.quickPicks;
  }, [oystehrZambda]);

  const createInsurance = useCallback(
    async (data: Omit<InsuranceQuickPickData, 'id'>) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      const response = await createInsuranceQuickPick(oystehrZambda, { quickPick: data });
      return response.quickPick;
    },
    [oystehrZambda]
  );

  const removeInsurance = useCallback(
    async (id: string) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      await removeInsuranceQuickPick(oystehrZambda, id);
    },
    [oystehrZambda]
  );

  // ── Medical condition callbacks ──
  const fetchConditions = useCallback(async () => {
    if (!oystehrZambda) return [];
    const response = await getMedicalConditionQuickPicks(oystehrZambda);
    return response.quickPicks;
  }, [oystehrZambda]);

  const createCondition = useCallback(
    async (data: Omit<MedicalConditionQuickPickData, 'id'>) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      const response = await createMedicalConditionQuickPick(oystehrZambda, { quickPick: data });
      return response.quickPick;
    },
    [oystehrZambda]
  );

  const removeCondition = useCallback(
    async (id: string) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      await removeMedicalConditionQuickPick(oystehrZambda, id);
    },
    [oystehrZambda]
  );

  // ── Medication callbacks ──
  const fetchMedications = useCallback(async () => {
    if (!oystehrZambda) return [];
    const response = await getMedicationHistoryQuickPicks(oystehrZambda);
    return response.quickPicks;
  }, [oystehrZambda]);

  const createMedication = useCallback(
    async (data: Omit<MedicationHistoryQuickPickData, 'id'>) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      const response = await createMedicationHistoryQuickPick(oystehrZambda, { quickPick: data });
      return response.quickPick;
    },
    [oystehrZambda]
  );

  const removeMedication = useCallback(
    async (id: string) => {
      if (!oystehrZambda) throw new Error('oystehrZambda was null');
      await removeMedicationHistoryQuickPick(oystehrZambda, id);
    },
    [oystehrZambda]
  );

  return (
    <Box>
      <TabContext value={subTab}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <TabList onChange={(_, v) => setSubTab(v)} aria-label="Quick pick categories">
            <Tab label="Procedures" value="procedures" sx={{ textTransform: 'none' }} />
            <Tab label="Allergies" value="allergies" sx={{ textTransform: 'none' }} />
            <Tab label="Insurance" value="insurance" sx={{ textTransform: 'none' }} />
            <Tab label="Medical Conditions" value="medical-conditions" sx={{ textTransform: 'none' }} />
            <Tab label="Medications" value="medications" sx={{ textTransform: 'none' }} />
            <Tab label="Radiology" value="radiology" sx={{ textTransform: 'none' }} />
            <Tab label="Immunizations" value="immunizations" sx={{ textTransform: 'none' }} />
            <Tab label="In-House Medications" value="in-house-medications" sx={{ textTransform: 'none' }} />
          </TabList>
        </Box>

        <TabPanel value="procedures" sx={{ px: 0 }}>
          <ProcedureQuickPicksPage />
        </TabPanel>

        <TabPanel value="allergies" sx={{ px: 0 }}>
          <QuickPickEditor<AllergyQuickPickData>
            title="Allergy Quick Picks"
            description="Manage common allergies that appear as quick picks when documenting patient allergies."
            columns={[{ label: 'Name', getValue: (item) => item.name }]}
            fields={[
              {
                key: 'name',
                label: 'Agent/Substance',
                required: true,
                renderField: (value, onValueChange, onExtraData) => (
                  <AllergenSearchField value={value} onChange={onValueChange} onExtraData={onExtraData} />
                ),
              },
            ]}
            editable={false}
            fetchItems={fetchAllergies}
            createItem={createAllergy}
            removeItem={removeAllergy}
            buildItemFromFields={(values) => ({
              name: values.name.trim(),
              ...(values.allergyId ? { allergyId: Number(values.allergyId) } : {}),
            })}
          />
        </TabPanel>

        <TabPanel value="insurance" sx={{ px: 0 }}>
          <QuickPickEditor<InsuranceQuickPickData>
            title="Insurance Quick Picks"
            description="Manage common insurance carriers that appear as quick picks on the visit details and patient profile screens."
            columns={[{ label: 'Insurance Name', getValue: (item) => item.name }]}
            fields={[
              {
                key: 'name',
                label: 'Insurance',
                required: true,
                renderField: (value, onValueChange, onExtraData) => (
                  <InsuranceCarrierSearchField value={value} onChange={onValueChange} onExtraData={onExtraData} />
                ),
              },
            ]}
            editable={false}
            fetchItems={fetchInsurance}
            createItem={createInsurance}
            removeItem={removeInsurance}
            buildItemFromFields={(values) => ({
              name: values.name.trim(),
              organizationId: values.organizationId ?? '',
            })}
          />
        </TabPanel>

        <TabPanel value="medical-conditions" sx={{ px: 0 }}>
          <QuickPickEditor<MedicalConditionQuickPickData>
            title="Medical Condition Quick Picks"
            description="Manage common medical conditions that appear as quick picks when documenting patient history."
            columns={[
              { label: 'Display Name', getValue: (item) => item.display },
              { label: 'ICD-10 Code', getValue: (item) => item.code ?? '', width: 150 },
            ]}
            fields={[
              {
                key: 'display',
                label: 'Medical Condition',
                required: true,
                renderField: (value, onValueChange, onExtraData) => (
                  <MedicalConditionSearchField value={value} onChange={onValueChange} onExtraData={onExtraData} />
                ),
              },
            ]}
            editable={false}
            fetchItems={fetchConditions}
            createItem={createCondition}
            removeItem={removeCondition}
            buildItemFromFields={(values) => ({
              display: values.display.trim(),
              ...(values.code?.trim() ? { code: values.code.trim() } : {}),
            })}
          />
        </TabPanel>

        <TabPanel value="medications" sx={{ px: 0 }}>
          <QuickPickEditor<MedicationHistoryQuickPickData>
            title="Medication Quick Picks"
            description="Manage common medications that appear as quick picks when documenting current medications."
            columns={[
              { label: 'Name', getValue: (item) => item.name },
              { label: 'Strength', getValue: (item) => item.strength ?? '', width: 150 },
            ]}
            fields={[
              {
                key: 'name',
                label: 'Medication',
                required: true,
                renderField: (value, onValueChange, onExtraData) => (
                  <MedicationSearchField value={value} onChange={onValueChange} onExtraData={onExtraData} />
                ),
              },
            ]}
            editable={false}
            fetchItems={fetchMedications}
            createItem={createMedication}
            removeItem={removeMedication}
            buildItemFromFields={(values) => ({
              name: values.name.trim(),
              ...(values.strength?.trim() ? { strength: values.strength.trim() } : {}),
              ...(values.medicationId ? { medicationId: Number(values.medicationId) } : {}),
            })}
          />
        </TabPanel>
        <TabPanel value="radiology" sx={{ px: 0 }}>
          <RadiologyQuickPicksPage />
        </TabPanel>
        <TabPanel value="immunizations" sx={{ px: 0 }}>
          <ImmunizationQuickPicksPage />
        </TabPanel>
        <TabPanel value="in-house-medications" sx={{ px: 0 }}>
          <InHouseMedicationQuickPicksPage />
        </TabPanel>
      </TabContext>
    </Box>
  );
}
