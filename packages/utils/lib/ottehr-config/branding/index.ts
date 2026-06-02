import type { BrandingConfig, LogoConfig } from 'config-types';

const BRANDING_DATA: BrandingConfig = {
  projectName: 'AfterOurs Urgent Care',
  projectDomain: 'afteroursinc.com',
  email: {
    logoURL: '',
    palette: {
      deemphasizedText: '#00000061',
      headerText: '#283555',
      bodyText: '#000000DE',
      footerText: '#212130',
      buttonColor: '#283555',
    },
    sender: 'appointments@mail.afteroursinc.com',
  },
  logo: {
    default: '',
    email: '',
    pdf: '',
  },
  intake: {
    primaryIconAlt: 'AfterOurs Urgent Care',
    welcomeTitleBreak: false,
    primaryIconSize: 120,
    appBar: {
      backgroundColor: '#FFFFFF',
      logoHeight: '44px',
      logoutButtonTextColor: '#283555',
    },
  },
};

export const BRANDING_CONFIG = Object.freeze(BRANDING_DATA);

// Derived constant - defined here to avoid circular dependencies
// (types/constants.ts cannot import from ottehr-config without creating a cycle)
export const PROJECT_WEBSITE = `https://${BRANDING_CONFIG.projectDomain}`;

type LogoTarget = Exclude<keyof LogoConfig, 'default'>;

export function getLogoFor(target: LogoTarget): string | undefined {
  const { logo } = BRANDING_CONFIG;

  return logo?.[target] || logo?.default;
}
