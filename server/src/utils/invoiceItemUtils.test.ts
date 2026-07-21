import { describe, expect, it } from 'vitest';
import { getPersonaliseItItemMeta } from '@overseek/core';

describe('getPersonaliseItItemMeta', () => {
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
