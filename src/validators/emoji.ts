import type { ErrorType } from '~/types';


let REGEX = /^(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)(?:\u200D(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F))*$/u;


export default (error?: string): (value: unknown, errors: ErrorType) => void => {
    let msg = error || 'must be an emoji';

    return (value, errors) => {
        if (typeof value !== 'string' || !REGEX.test(value)) {
            errors.push(msg);
        }
    };
};
