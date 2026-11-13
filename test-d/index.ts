/**
 * Unit testing TypeScript types.
 * with https://github.com/SamVerschueren/tsd
 */

import { expectType } from 'tsd';
import * as mfm from '../src';
import type { NodeType, MfmUrl, MfmNode, MfmSimpleNode, MfmFn, MfmInline } from '../src';

expectType<MfmUrl>(null as unknown as NodeType<'url'>);
expectType<MfmFn>(null as unknown as NodeType<'fn'>);

expectType<MfmNode[]>(mfm.parse('abc'));
expectType<MfmNode[]>(mfm.parse('abc', { nestLimit: 3 }));
expectType<MfmSimpleNode[]>(mfm.parseSimple('abc'));
expectType<string>(mfm.toString(mfm.parse('abc')));
expectType<string>(mfm.toString(mfm.TEXT('abc')));
expectType<MfmNode[]>(mfm.extract(mfm.parse('abc'), node => node.type === 'text'));
expectType<MfmUrl>(mfm.N_URL('https://example.com', true));
expectType<MfmFn>(mfm.FN('tada', {}, [] as MfmInline[]));
