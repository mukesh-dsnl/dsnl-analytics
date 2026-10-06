import { handle } from '../../services/api';

export type SearchField = 'reg_nums' | 'phones' | 'emails' | 'cpins';

/** One list per search box; each holds the box's comma-separated values. */
export type SearchCriteria = Record<SearchField, string[]>;

export interface Registration {
  reg_num: string | number;
  name: string | null;
  phone: string | null;
  email: string | null;
  updated_at: string | null;
  source: number | null;
}

export interface RegistrationMatch extends Registration {
  profile_count: number;
  active_profile_count: number;
  /** Which search boxes this account matched. */
  matched_on: SearchField[];
  /** Profiles whose phone, email or CPIN matched a searched value. */
  matched_profiles: string[];
}

export interface Profile {
  profile_ref_num: string | number;
  profile_name: string | null;
  profile_phone: string | null;
  profile_email: string | null;
  conf_ref_num: string | number | null;
  chair_pin: string | null;
  participant_pin: string | null;
  status: number | null;
  account_type: number | null;
  isd_allowed: number | null;
  profile_size: number | null;
  ack_status: number | null;
  added_at: string | null;
  profile_updated_at: string | null;
  is_default: number | null;
}

export interface SearchResults {
  rows: RegistrationMatch[];
  truncated: boolean;
}

export interface RegistrationPage {
  registration: Registration;
  profiles: Profile[];
  page: number;
  has_more: boolean;
}

export const multicallApi = {
  search: async (criteria: SearchCriteria): Promise<SearchResults> => {
    const response = await fetch('/api/multicall/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(criteria),
    });
    return handle<SearchResults>(response);
  },

  registration: async (regNum: string, page: number): Promise<RegistrationPage> => {
    const response = await fetch(
      `/api/multicall/registrations/${encodeURIComponent(regNum)}?page=${page}`,
    );
    return handle<RegistrationPage>(response);
  },
};
