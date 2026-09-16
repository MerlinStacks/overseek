import { describe, expect, it } from 'vitest';
import { getPersonaliseItItemMeta } from '@overseek/core';

describe('getPersonaliseItItemMeta', () => {
    it.each(['engraving', 'sublimation', 'uv', ' UV '])('omits %s colours without hiding text, fonts, or embroidery colours', (printMethod) => {
        const layer = {
            type: 'text',
            label: 'Name',
            input: { value: 'Alex', fontName: 'Montserrat', colorHex: '#123456', colorName: 'Navy' },
        };
        const meta = getPersonaliseItItemMeta({
            meta_data: [{
                key: '_oc_customisation',
                value: {
                    renderSpec: {
                        areas: {
                            front: { printMethod, layers: [layer] },
                            back: { printMethod: 'embroidery', layers: [{ ...layer, label: 'Initials' }] },
                        },
                    },
                    // The raw selection must not reintroduce a suppressed colour.
                    layers: { 1: layer },
                },
            }],
        });

        expect(meta).toEqual([
            { label: 'Name', value: 'Alex' },
            { label: 'Name Font', value: 'Montserrat' },
            { label: 'Initials', value: 'Alex' },
            { label: 'Initials Font', value: 'Montserrat' },
            { label: 'Initials Colour', value: 'Navy (#123456)' },
        ]);
    });

    it.each(['engraving', 'sublimation', 'uv'])('honours a saved %s method in fallback metadata', (printMethod) => {
        for (const value of [
            { layers: { 1: { type: 'textarea', label: 'Name', value: 'Alex', printMethod, colourName: 'Navy' } } },
            { front: { text: 'Alex', print_method: printMethod, color: '#123456' } },
        ]) {
            const meta = getPersonaliseItItemMeta({ meta_data: [{ key: '_oc_customisation', value }] });
            expect(meta).toHaveLength(1);
            expect(meta[0].value).toBe('Alex');
        }
    });

    it('extracts text, font, and colour from the current render spec', () => {
        const meta = getPersonaliseItItemMeta({
            meta_data: [{
                key: '_oc_customisation',
                value: {
                    v: 2,
                    renderSpec: {
                        areas: {
                            front: {
                                layers: [{
                                    id: 317,
                                    type: 'text',
                                    label: 'Name',
                                    input: {
                                        value: 'Alex',
                                        fontId: 7,
                                        fontName: 'Montserrat',
                                        colorHex: '#123456',
                                        colorName: 'Navy',
                                    },
                                }],
                            },
                        },
                    },
                },
            }],
        });

        expect(meta).toEqual([
            { label: 'Name', value: 'Alex' },
            { label: 'Name Font', value: 'Montserrat' },
            { label: 'Name Colour', value: 'Navy (#123456)' },
        ]);
    });

    it('uses a stored font name and supports JSON encoded top-level layers', () => {
        const meta = getPersonaliseItItemMeta({
            meta_data: [{
                key: '_oc_customisation',
                value: JSON.stringify({
                    v: 2,
                    layers: {
                        12: {
                            type: 'textarea',
                            value: 'Line one',
                            fontId: 4,
                            fontName: 'Montserrat',
                            colourHex: '#abcdef',
                        },
                    },
                }),
            }],
        });

        expect(meta).toEqual([
            { label: 'Layer 12', value: 'Line one' },
            { label: 'Layer 12 Font', value: 'Montserrat' },
            { label: 'Layer 12 Colour', value: '#abcdef' },
        ]);
    });

    it('extracts text, font, and colour from legacy area metadata', () => {
        const meta = getPersonaliseItItemMeta({
            meta_data: [{
                key: '_oc_customisation',
                value: {
                    front: {
                        text: 'Hello World',
                        fontId: 1,
                        color: '#ff0000',
                    },
                },
            }],
        });

        expect(meta).toEqual([
            { label: 'Personalisation (Front)', value: 'Hello World' },
            { label: 'Personalisation (Front) Font', value: 'Font #1' },
            { label: 'Personalisation (Front) Colour', value: '#ff0000' },
        ]);
    });
});
