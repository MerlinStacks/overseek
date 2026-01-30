declare module 'react-quill' {
    import * as React from 'react';

    interface ReactQuillProps {
        value?: string;
        onChange?: (value: string) => void;
        theme?: string;
        className?: string;
        modules?: object;
        formats?: string[];
        placeholder?: string;
        readOnly?: boolean;
        bounds?: string | HTMLElement;
    }

    export default class ReactQuill extends React.Component<ReactQuillProps> { }
}
