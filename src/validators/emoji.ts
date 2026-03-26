import type { ValidatorFunction } from '~/types';


let RE = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;


const emoji = (error?: string): ValidatorFunction<unknown> => {
    let msg = error || 'must be an emoji';

    return (value, errors) => {
        if (typeof value !== 'string' || !RE.test(value)) {
            errors.push(msg);
        }
    };
};


export default emoji;
