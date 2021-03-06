import { Component, forwardRef, ElementRef, Input, ViewChild, HostListener } from '@angular/core';
import { NG_VALUE_ACCESSOR, ControlValueAccessor } from '@angular/forms';

@Component({
    selector: 'ng-path-input',
    template: `
        <ng-content></ng-content>
        <input style="display: none;" #fileInput type="file" [attr.webkitdirectory]="directory" (change)="readInput()"/>
    `,
    providers: [{
        provide: NG_VALUE_ACCESSOR,
        useExisting: forwardRef(() => PathInputComponent),
        multi: true
    }]
})
export class PathInputComponent implements ControlValueAccessor {
    @ViewChild('fileInput', { read: ElementRef })
    private fileInput: ElementRef;
    private currentValue: string = null;
    private onChange = (_: any) => { };
    private onTouched = () => { };

    @Input() private directory: boolean = false;

    constructor() { }

    @HostListener('click')
    onClick() {
        if (this.fileInput && this.fileInput.nativeElement) {
            let fileInput = <HTMLInputElement>this.fileInput.nativeElement;
            fileInput.click();
        }
    }

    private readInput() {
        let fileInput = <HTMLInputElement>this.fileInput.nativeElement;
        if (fileInput.files && fileInput.files.length) {
            this.writeValue(fileInput.files[0].path);
            fileInput.value = null;
        }
    }

    @Input()
    set value(value: string) {
        let oldValue = this.currentValue;

        if (value !== oldValue) {
            this.currentValue = value;
            this.onChange(value);
        }

        this.onTouched();
    }

    get value() {
        return this.currentValue;
    }

    writeValue(value: any): void {
        this.value = value;
    }

    registerOnChange(fn: (value: any) => any): void {
        this.onChange = fn;
    }

    registerOnTouched(fn: () => any): void {
        this.onTouched = fn;
    }
}