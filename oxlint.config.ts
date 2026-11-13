import { defineMisskeyDevOxlintConfig } from '@misskey-dev/oxlint-fmt-config';

export default defineMisskeyDevOxlintConfig({
	overrides: {
		ignorePatterns: [
			'built',
			'test',
			'test-d',
			'compare',
		],
	},
});
