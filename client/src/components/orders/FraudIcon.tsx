import { FraudRiskIndicator } from './FraudRiskIndicator';

export function FraudIcon(props: { orderId: number | string; className?: string }) {
    return <FraudRiskIndicator {...props} compact />;
}
