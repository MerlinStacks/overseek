import { FraudRiskIndicator } from './FraudRiskIndicator';

export function FraudBadge(props: { orderId: string; className?: string }) {
    return <FraudRiskIndicator {...props} />;
}
