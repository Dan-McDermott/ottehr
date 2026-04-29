import { TabContext, TabList, TabPanel } from '@mui/lab';
import { Box, Tab } from '@mui/material';
import { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import { BILLING_URL } from 'src/App';
import Invoicing from 'src/rcm/features/invoicing/Invoicing';
import FeeSchedule from './ChargeItemList';
import EmployersTab from './employers/EmployersTab';
import Insurances from './Insurance';

type BillingSubTab = 'insurance' | 'fee-schedules' | 'charge-masters' | 'employers' | 'invoicing';

export default function BillingConfiguration({ billingTab }: { billingTab?: string }): ReactElement {
  const navigate = useNavigate();
  const subTab: BillingSubTab = (billingTab as BillingSubTab) || 'insurance';

  const handleSubTabChange = (_: unknown, newValue: BillingSubTab): void => {
    navigate(`${BILLING_URL}/${newValue}`);
  };

  return (
    <Box sx={{ marginTop: 2 }}>
      <TabContext value={subTab}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <TabList onChange={handleSubTabChange} aria-label="Billing configuration tabs">
            <Tab label="Insurance" value="insurance" sx={{ textTransform: 'none', fontWeight: 500 }} />
            <Tab label="Fee Schedules" value="fee-schedules" sx={{ textTransform: 'none', fontWeight: 500 }} />
            <Tab label="Charge Masters" value="charge-masters" sx={{ textTransform: 'none', fontWeight: 500 }} />
            <Tab label="Employers" value="employers" sx={{ textTransform: 'none', fontWeight: 500 }} />
            <Tab label="Invoicing" value="invoicing" sx={{ textTransform: 'none', fontWeight: 500 }} />
          </TabList>
        </Box>
        <TabPanel value="insurance" sx={{ padding: 0 }}>
          <Insurances />
        </TabPanel>
        <TabPanel value="fee-schedules" sx={{ padding: 0 }}>
          <FeeSchedule />
        </TabPanel>
        <TabPanel value="charge-masters" sx={{ padding: 0 }}>
          <FeeSchedule mode="charge-master" />
        </TabPanel>
        <TabPanel value="employers" sx={{ padding: 0 }}>
          <EmployersTab />
        </TabPanel>
        <TabPanel value="invoicing" sx={{ padding: 0 }}>
          <Invoicing />
        </TabPanel>
      </TabContext>
    </Box>
  );
}
