import type { SearchProfile, UserProfile } from "../types/index.js";
import {
	loadSearchProfiles,
	readUserProfileConfig,
	writeUserProfileConfig,
} from "./profile-config.js";

/** Keeps the last valid matcher configuration while profiles are edited at runtime. */
export class ProfileStore {
	private profiles: SearchProfile[];

	public constructor(private readonly profilePath?: string) {
		this.profiles = loadSearchProfiles(profilePath);
	}

	public get(): readonly SearchProfile[] {
		return this.profiles;
	}

	public getUserProfiles(): UserProfile[] | undefined {
		return readUserProfileConfig(this.profilePath)?.profiles;
	}

	public saveUserProfiles(profiles: UserProfile[]): void {
		// writeUserProfileConfig validates before its atomic rename. Only replace the in-memory
		// matcher after both write and reload succeeded, preserving the previous working state.
		writeUserProfileConfig({ profiles }, this.profilePath);
		const nextProfiles = loadSearchProfiles(this.profilePath);
		this.profiles = nextProfiles;
	}
}
